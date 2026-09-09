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

async function configureDirectDownload(target, downloadPath) {
  // chrome.debugger exposes the Page domain on tab targets. The Browser-domain
  // variant exists in full CDP clients but is not available through this API on
  // affected Chrome builds (it returns JSON-RPC -32601).
  try {
    await chrome.debugger.sendCommand(target, "Page.setDownloadBehavior", {
      behavior: "allow", downloadPath
    });
    return "Page.setDownloadBehavior";
  } catch (pageError) {
    try {
      await chrome.debugger.sendCommand(target, "Browser.setDownloadBehavior", {
        behavior: "allow", downloadPath, eventsEnabled: true
      });
      return "Browser.setDownloadBehavior";
    } catch (browserError) {
      throw new Error(
        `Chrome non consente il download diretto sul NAS: Page=${pageError.message}; Browser=${browserError.message}`
      );
    }
  }
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
  if (job && !job.downloadId) await setJob({...job, downloadId: item.id});
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
    const [current] = await chrome.downloads.search({id: delta.id});
    const percent = current.totalBytes > 0 ? current.bytesReceived / current.totalBytes * 100 : 0;
    chrome.runtime.sendMessage({type:"progress-ui",phase:"downloading",phaseLabel:"Download da Google Foto",message:current.totalBytes>0?`Scaricati ${(current.bytesReceived/1048576).toFixed(1)} di ${(current.totalBytes/1048576).toFixed(1)} MB`:`Scaricati ${(current.bytesReceived/1048576).toFixed(1)} MB`,processPercent:30+percent*.35,batchPercent:percent,batchLabel:"Download ZIP",detail:current.filename.split("/").pop()}).catch(()=>{});
  }
  if (delta.error) {
    await setJob(null);
    await chrome.tabs.sendMessage(job.tabId, {type: "batchResult", ok: false, error: `Chrome: ${delta.error.current}`}).catch(() => {});
  } else if (delta.state?.current === "complete") {
    try {
      const [item] = await chrome.downloads.search({id: delta.id});
      chrome.runtime.sendMessage({type:"progress-ui",phase:"extracting",phaseLabel:"Estrazione sul My Cloud",message:"Download completo, estrazione e verifica in corso",processPercent:72,batchPercent:0,batchLabel:"Estrazione file",detail:item.filename.split("/").pop()}).catch(()=>{});
      const moved = await nativeMessage({
        command: "move", source: item.filename, destination: job.settings.destination,
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

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "progress") {
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
      const modifiers = message.shift ? 8 : 0;
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {type: "mousePressed", x: message.x, y: message.y, button: "left", clickCount: 1, modifiers});
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {type: "mouseReleased", x: message.x, y: message.y, button: "left", clickCount: 1, modifiers});
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
      const prepared = await nativeMessage({command: "prepare", destination: message.settings.destination});
      const target = await ensureDebugger(tabId);
      const downloadCommand = await configureDirectDownload(target, prepared.downloadPath);
      chrome.runtime.sendMessage({type:"progress-ui",phase:"requesting-download",phaseLabel:"Download diretto configurato",message:"Chrome scriverà lo ZIP direttamente sul My Cloud",processPercent:28,batchPercent:100,batchLabel:"Destinazione pronta",detail:`${downloadCommand} → ${prepared.downloadPath}`}).catch(()=>{});
      await setJob({tabId, settings: message.settings, photoIds: message.photoIds, downloadPath: prepared.downloadPath, downloadCommand, downloadId: null, startedAt: Date.now() - 1000});
      await dispatchShiftD(tabId);
      respond({ok: true});
    }).catch(async error => {
      await setJob(null);
      respond({ok: false, error: error.message});
    });
    return true;
  }
});
