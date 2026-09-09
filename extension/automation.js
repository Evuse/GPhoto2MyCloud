(() => {
  "use strict";
  let running = false;
  let stopped = false;
  let selected = [];
  let processed = new Set();
  let observed = new Set();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = (phase, message, extra = {}) => chrome.runtime.sendMessage({
    type: "progress", phase, message, processed: processed.size, discovered: observed.size, ...extra
  });

  function visiblePhotoCheckboxes() {
    const result = new Map();
    for (const link of document.querySelectorAll('a[href*="/photo/"]')) {
      const id = GPhotoPlanner.photoId(link.href, location.href);
      if (!id) continue;
      observed.add(id);
      let container = link;
      let checkbox = null;
      for (let depth = 0; container && depth < 8; depth += 1, container = container.parentElement) {
        checkbox = container.querySelector?.('[role="checkbox"]');
        if (checkbox) break;
      }
      if (!checkbox || checkbox.getAttribute("aria-checked") === "true") continue;
      const box = checkbox.getBoundingClientRect();
      if (box.width < 10 || box.height < 10 || box.bottom < 0 || box.top > innerHeight) continue;
      if (!processed.has(id)) result.set(id, {id, checkbox});
    }
    return [...result.values()];
  }

  async function selectBatch(settings) {
    selected = [];
    let bottomChecks = 0;
    while (!stopped && selected.length < settings.batchSize && bottomChecks < 5) {
      const candidates = visiblePhotoCheckboxes().filter(item => !selected.some(value => value.id === item.id));
      for (const item of candidates) {
        if (selected.length >= settings.batchSize || stopped) break;
        item.checkbox.click();
        await sleep(settings.clickDelayMs);
        if (item.checkbox.getAttribute("aria-checked") === "true") {
          selected.push(item);
          report("selecting", `Selezionate ${selected.length}/${settings.batchSize} · ${processed.size} già archiviate`, {selected: selected.length});
        }
      }
      if (selected.length >= settings.batchSize) break;
      const before = scrollY;
      scrollBy({top: Math.max(500, innerHeight * 0.8), behavior: "instant"});
      await sleep(settings.settleSeconds * 1000);
      bottomChecks = Math.abs(scrollY - before) < 2 ? bottomChecks + 1 : 0;
    }
    return selected;
  }

  async function clearSelection() {
    await chrome.runtime.sendMessage({type: "clearSelection"}).catch(() => {});
    await sleep(300);
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

  async function saveCompleted(items) {
    items.forEach(item => processed.add(item.id));
    await chrome.storage.local.set({completedPhotoIds: [...processed]});
  }

  async function start(rawSettings) {
    if (running) return;
    running = true;
    stopped = false;
    observed = new Set();
    processed = new Set((await chrome.storage.local.get("completedPhotoIds")).completedPhotoIds || []);
    const settings = GPhotoPlanner.clampSettings(rawSettings);
    scrollTo({top: 0, behavior: "instant"});
    await sleep(settings.settleSeconds * 1000);
    report("starting", `Scansione dall'inizio · ${processed.size} elementi già completati`);
    try {
      while (!stopped) {
        const batch = await selectBatch(settings);
        if (!batch.length) {
          if (!observed.size) throw new Error("Nessuna tessera riconosciuta: la struttura di Google Foto potrebbe essere cambiata");
          report("complete", `Scansione completa: ${processed.size} elementi archiviati, ${observed.size} identificativi verificati in questa scansione.`, {selected: 0});
          break;
        }
        report("requesting-download", `Download di ${batch.length} elementi…`, {selected: batch.length});
        const completion = waitForBatch();
        const response = await chrome.runtime.sendMessage({type: "downloadBatch", count: batch.length, photoIds: batch.map(item => item.id), settings});
        if (!response?.ok) throw new Error(response?.error || "Download non avviato");
        await completion;
        await saveCompleted(batch);
        report("batch-complete", `Lotto verificato sul My Cloud · totale ${processed.size}`, {selected: batch.length});
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
