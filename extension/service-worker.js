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

async function dispatchShiftD(tabId) {
  const target = {tabId};
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown", key: "D", code: "KeyD", modifiers: 8, windowsVirtualKeyCode: 68
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp", key: "D", code: "KeyD", modifiers: 8, windowsVirtualKeyCode: 68
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function dispatchEscape(tabId) {
  const target = {tabId};
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
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
  if (delta.error) {
    await setJob(null);
    await chrome.tabs.sendMessage(job.tabId, {type: "batchResult", ok: false, error: `Chrome: ${delta.error.current}`}).catch(() => {});
  } else if (delta.state?.current === "complete") {
    try {
      const [item] = await chrome.downloads.search({id: delta.id});
      const moved = await nativeMessage({
        command: "move", source: item.filename, destination: job.settings.destination,
        downloadRoot: job.settings.downloadRoot,
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
      await setJob({tabId, settings: message.settings, photoIds: message.photoIds, downloadId: null, startedAt: Date.now() - 1000});
      await dispatchShiftD(tabId);
      respond({ok: true});
    }).catch(async error => {
      await setJob(null);
      respond({ok: false, error: error.message});
    });
    return true;
  }
});
