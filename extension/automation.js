(() => {
  "use strict";
  let running = false;
  let stopped = false;
  let selected = [];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = (phase, message, extra = {}) => chrome.runtime.sendMessage({type: "progress", phase, message, ...extra});

  function photoCheckboxes() {
    return [...document.querySelectorAll('[role="checkbox"]')].filter(node => {
      if (node.getAttribute("aria-checked") === "true") return false;
      const box = node.getBoundingClientRect();
      if (box.width < 10 || box.height < 10 || box.bottom < 0 || box.top > innerHeight) return false;
      // Photo checkboxes live inside a tile containing a /photo/ link. This deliberately
      // excludes navigation and "select day" controls that could overrun a batch.
      let parent = node;
      for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
        if (parent.querySelector?.('a[href*="/photo/"]')) return true;
      }
      return false;
    });
  }

  async function selectBatch(settings) {
    selected = [];
    let stagnant = 0;
    while (!stopped && selected.length < settings.batchSize && stagnant < 8) {
      const candidates = photoCheckboxes().filter(item => !item.dataset.gp2mcDone);
      if (!candidates.length) {
        stagnant += 1;
        scrollBy({top: Math.max(500, innerHeight * 0.8), behavior: "smooth"});
        await sleep(settings.settleSeconds * 1000);
        continue;
      }
      stagnant = 0;
      for (const checkbox of candidates) {
        if (selected.length >= settings.batchSize || stopped) break;
        checkbox.click();
        checkbox.dataset.gp2mcDone = "1";
        selected.push(checkbox);
        report("selecting", `Selezione ${selected.length}/${settings.batchSize}`, {selected: selected.length});
        await sleep(settings.clickDelayMs);
      }
      scrollBy({top: Math.max(400, innerHeight * 0.65), behavior: "smooth"});
      await sleep(settings.settleSeconds * 1000);
    }
    return selected.length;
  }

  async function clearSelection() {
    for (const checkbox of selected) {
      if (checkbox.isConnected && checkbox.getAttribute("aria-checked") === "true") checkbox.click();
      await sleep(50);
    }
    selected = [];
  }

  function waitForBatch() {
    return new Promise((resolve, reject) => {
      const listener = message => {
        if (message.type !== "batchResult") return;
        chrome.runtime.onMessage.removeListener(listener);
        if (message.ok) resolve(message);
        else reject(new Error(message.error || "Download non riuscito"));
      };
      chrome.runtime.onMessage.addListener(listener);
    });
  }

  async function start(rawSettings) {
    if (running) return;
    running = true;
    stopped = false;
    const settings = GPhotoPlanner.clampSettings(rawSettings);
    report("starting", "Analisi della griglia Google Foto…");
    try {
      while (!stopped) {
        const count = await selectBatch(settings);
        if (!count) {
          report("complete", "Nessun'altra foto trovata. Backup terminato.", {selected: 0});
          break;
        }
        report("requesting-download", `Richiesta download di ${count} elementi…`, {selected: count});
        const completion = waitForBatch();
        const response = await chrome.runtime.sendMessage({type: "downloadBatch", count, settings});
        if (!response?.ok) throw new Error(response?.error || "Download non avviato");
        await completion;
        report("batch-complete", `Lotto di ${count} elementi verificato e copiato sul My Cloud.`, {selected: count});
        await clearSelection();
      }
    } catch (error) {
      report("error", error.message || String(error));
      await clearSelection();
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "start") { start(message.settings); respond({ok: true}); }
    if (message.type === "stop") { stopped = true; respond({ok: true}); }
  });
})();
