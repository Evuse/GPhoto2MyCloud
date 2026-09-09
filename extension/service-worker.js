"use strict";

chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});

async function getJob() {
  return (await chrome.storage.session.get("activeJob")).activeJob;
}

async function setJob(job) {
  if (job) await chrome.storage.session.set({activeJob: job});
  else await chrome.storage.session.remove("activeJob");
}

async function markCompleted(photoIds) {
  const current = (await chrome.storage.local.get("completedPhotoIds")).completedPhotoIds || [];
  await chrome.storage.local.set({completedPhotoIds: [...new Set([...current, ...photoIds])]});
}

function nativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage("it.gphoto2mycloud.host", payload, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error || "Errore del servizio macOS"));
      else resolve(response);
    });
  });
}

function nativeMoveWithProgress(payload) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative("it.gphoto2mycloud.host");
    let settled = false;
    port.onMessage.addListener(response => {
      if (response?.event === "progress") {
        chrome.runtime.sendMessage({
          type:"progress-ui", phase:"extracting", phaseLabel:response.phaseLabel,
          message:response.message, processPercent:72 + response.percent * .27,
          batchPercent:response.percent, batchLabel:`Estrazione ${response.current}/${response.total}`,
          detail:response.file || ""
        }).catch(() => {});
      } else if (response?.ok) {
        settled = true;
        resolve(response);
        port.disconnect();
      } else {
        settled = true;
        reject(new Error(response?.error || "Errore durante l'estrazione"));
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!settled) reject(new Error(chrome.runtime.lastError?.message || "Servizio macOS disconnesso durante l'estrazione"));
    });
    port.postMessage(payload);
  });
}

async function ensureDebugger(tabId) {
  const target = {tabId};
  const targets = await chrome.debugger.getTargets();
  if (!targets.some(item => item.tabId === tabId && item.attached)) {
    await chrome.debugger.attach(target, "1.3");
  }
  await chrome.debugger.sendCommand(target, "Emulation.setFocusEmulationEnabled", {enabled: true});
  await chrome.debugger.sendCommand(target, "Emulation.setIdleOverride", {isUserActive: true, isScreenUnlocked: true});
  await chrome.debugger.sendCommand(target, "Page.setWebLifecycleState", {state: "active"}).catch(() => {});
  return target;
}

async function dispatchShiftD(tabId) {
  const target = await ensureDebugger(tabId);
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown", key: "D", code: "KeyD", modifiers: 8, windowsVirtualKeyCode: 68
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp", key: "D", code: "KeyD", modifiers: 8, windowsVirtualKeyCode: 68
    });
}

async function dispatchEscape(tabId) {
  const target = await ensureDebugger(tabId);
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
    });
}

chrome.downloads.onCreated.addListener(async item => {
  const job = await getJob();
  if (job && !job.downloadId) {
    await setJob({...job, downloadId: item.id});
    await chrome.alarms.clear("gphoto-download-watchdog");
    chrome.alarms.create("gphoto-download-watchdog", {delayInMinutes: job.settings.downloadTimeoutMinutes});
  }
});

chrome.downloads.onChanged.addListener(async delta => {
  const job = await getJob();
  if (job && !job.downloadId) {
    const [candidate] = await chrome.downloads.search({id: delta.id});
    if (candidate && new Date(candidate.startTime).getTime() >= job.startedAt) {
      job.downloadId = delta.id;
      await setJob(job);
    }
  }
  if (!job || job.downloadId !== delta.id) return;
  if (delta.bytesReceived || delta.totalBytes) {
    await chrome.alarms.clear("gphoto-download-watchdog");
    chrome.alarms.create("gphoto-download-watchdog", {delayInMinutes: job.settings.downloadTimeoutMinutes});
    const [current] = await chrome.downloads.search({id: delta.id});
    const percent = current.totalBytes > 0 ? current.bytesReceived / current.totalBytes * 100 : 0;
    chrome.runtime.sendMessage({type:"progress-ui",phase:"downloading",phaseLabel:"Download da Google Foto",message:current.totalBytes>0?`Scaricati ${(current.bytesReceived/1048576).toFixed(1)} di ${(current.totalBytes/1048576).toFixed(1)} MB`:`Scaricati ${(current.bytesReceived/1048576).toFixed(1)} MB`,processPercent:30+percent*.35,batchPercent:percent,batchLabel:"Download ZIP",detail:current.filename.split("/").pop()}).catch(()=>{});
  }
  if (delta.error) {
    await chrome.alarms.clear("gphoto-download-watchdog");
    await setJob(null);
    await chrome.tabs.sendMessage(job.tabId, {type: "batchResult", ok: false, error: `Chrome: ${delta.error.current}`}).catch(() => {});
  } else if (delta.state?.current === "complete") {
    await chrome.alarms.clear("gphoto-download-watchdog");
    try {
      const [item] = await chrome.downloads.search({id: delta.id});
      chrome.runtime.sendMessage({type:"progress-ui",phase:"extracting",phaseLabel:"Estrazione sul My Cloud",message:"Download completo, estrazione e verifica in corso",processPercent:72,batchPercent:0,batchLabel:"Estrazione file",detail:item.filename.split("/").pop()}).catch(()=>{});
      const moved = await nativeMoveWithProgress({
        command: "move", source: item.filename, destination: job.settings.destination,
        downloadRoot: job.settings.downloadRoot,
        extractedFolder: job.settings.extractedFolder,
        keepArchives: job.settings.keepArchives,
        photoIds: job.photoIds,
        verify: job.settings.verifyCopies
      });
      await markCompleted(job.photoIds);
      await setJob(null);
      await chrome.tabs.sendMessage(job.tabId, {type: "batchResult", ok: true, moved}).catch(() => {});
    } catch (error) {
      await setJob(null);
      await chrome.tabs.sendMessage(job.tabId, {type: "batchResult", ok: false, error: error.message}).catch(() => {});
    }
  }
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== "gphoto-download-watchdog") return;
  const job = await getJob();
  if (!job) return;
  if (job.downloadId) await chrome.downloads.cancel(job.downloadId).catch(() => {});
  await setJob(null);
  await chrome.tabs.sendMessage(job.tabId, {type:"batchResult",ok:false,error:`Download senza avanzamento per ${job.settings.downloadTimeoutMinutes} minuti`}).catch(() => {});
});

async function resumeRequested(tabId) {
  const {syncDesired, settings} = await chrome.storage.local.get(["syncDesired", "settings"]);
  if (!syncDesired || !settings) return;
  chrome.tabs.sendMessage(tabId, {type:"start", settings}).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && tab.url?.startsWith("https://photos.google.com/")) resumeRequested(tabId);
});
chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({url:"https://photos.google.com/*"});
  if (tabs[0]) resumeRequested(tabs[0].id);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "progress") {
    if (message.phase === "complete") chrome.storage.local.set({syncDesired:false});
    chrome.runtime.sendMessage({...message, type: "progress-ui"}).catch(() => {});
    return;
  }
  if (message.type === "hostStatus") {
    nativeMessage({command: "status", destination: message.destination}).then(respond, error => respond({ok: false, error: error.message}));
    return true;
  }
  if (message.type === "prepareAutomation") {
    if (!sender.tab?.id) { respond({ok: false, error: "Scheda non disponibile"}); return; }
    ensureDebugger(sender.tab.id).then(() => respond({ok: true}), error => respond({ok: false, error: error.message}));
    return true;
  }
  if (message.type === "releaseAutomation") {
    if (sender.tab?.id) chrome.debugger.detach({tabId: sender.tab.id}).catch(() => {});
    respond({ok: true});
    return;
  }
  if (message.type === "trustedClick") {
    if (!sender.tab?.id) { respond({ok: false, error: "Scheda non disponibile"}); return; }
    ensureDebugger(sender.tab.id).then(async target => {
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {type: "mousePressed", x: message.x, y: message.y, button: "left", clickCount: 1});
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {type: "mouseReleased", x: message.x, y: message.y, button: "left", clickCount: 1});
      respond({ok: true});
    }, error => respond({ok: false, error: error.message}));
    return true;
  }
  if (message.type === "clearSelection") {
    if (!sender.tab?.id) { respond({ok: false}); return; }
    dispatchEscape(sender.tab.id).then(() => respond({ok: true}), error => respond({ok: false, error: error.message}));
    return true;
  }
  if (message.type === "downloadBatch") {
    const tabId = sender.tab?.id;
    if (!tabId) { respond({ok: false, error: "Scheda Google Foto non disponibile"}); return; }
    getJob().then(async existing => {
      if (existing) throw new Error("Lotto già attivo");
      const prepared = await nativeMessage({command: "prepare", destination: message.settings.destination, downloadRoot: message.settings.downloadRoot});
      chrome.runtime.sendMessage({type:"progress-ui",phase:"requesting-download",phaseLabel:"Download locale pronto",message:"Chrome salverà temporaneamente lo ZIP sul Mac",processPercent:28,batchPercent:100,batchLabel:"Destinazione pronta",detail:`Cartella attesa: ${prepared.downloadPath}`}).catch(()=>{});
      await setJob({tabId, settings: message.settings, photoIds: message.photoIds, downloadPath: prepared.downloadPath, downloadId: null, startedAt: Date.now() - 1000});
      chrome.alarms.create("gphoto-download-watchdog", {delayInMinutes: message.settings.downloadTimeoutMinutes});
      await dispatchShiftD(tabId);
      respond({ok: true});
    }).catch(async error => {
      await setJob(null);
      respond({ok: false, error: error.message});
    });
    return true;
  }
});
