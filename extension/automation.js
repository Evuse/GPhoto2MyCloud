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

  function timelineScroller() {
    const tile = document.querySelector('a[href*="/photo/"]');
    for (let node = tile?.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 50) return node;
    }
    const candidates = [...document.querySelectorAll("main, [role=main], div")]
      .filter(node => node.clientHeight > innerHeight * 0.45 && node.scrollHeight > node.clientHeight + 100)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return candidates[0] || document.scrollingElement;
  }

  function scrollPosition(scroller) {
    return scroller === document.scrollingElement ? scrollY : scroller.scrollTop;
  }

  async function advanceTimeline(settings) {
    const scroller = timelineScroller();
    const before = scrollPosition(scroller);
    const beforeHeight = scroller.scrollHeight;
    const distance = Math.max(500, scroller.clientHeight * 0.8);
    if (scroller === document.scrollingElement) scrollTo(0, before + distance);
    else {
      scroller.scrollTop = before + distance;
      scroller.dispatchEvent(new Event("scroll", {bubbles: true}));
    }
    await sleep(settings.settleSeconds * 1000);
    return scrollPosition(scroller) > before + 1 || scroller.scrollHeight > beforeHeight;
  }

  function rewindTimeline() {
    const scroller = timelineScroller();
    if (scroller === document.scrollingElement) scrollTo(0, 0);
    else {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll", {bubbles: true}));
    }
  }

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

  function visibleProcessedItems() {
    return [...document.querySelectorAll('a[href*="/photo/"]')]
      .some(link => processed.has(GPhotoPlanner.photoId(link.href, location.href)));
  }

  async function trustedClick(checkbox, shift) {
    const box = checkbox.getBoundingClientRect();
    const response = await chrome.runtime.sendMessage({
      type: "trustedClick", x: box.left + box.width / 2, y: box.top + box.height / 2, shift
    });
    if (!response?.ok) throw new Error(response?.error || "Click Chrome non riuscito");
    await sleep(shift ? Math.max(500, settingsForClickDelay) : settingsForClickDelay);
  }

  let settingsForClickDelay = 350;

  async function selectBatch(settings) {
    selected = [];
    settingsForClickDelay = settings.clickDelayMs;
    let bottomChecks = 0;
    while (!stopped && selected.length < settings.batchSize && bottomChecks < 5) {
      const candidates = visiblePhotoCheckboxes().filter(item => !selected.some(value => value.id === item.id));
      const room = settings.batchSize - selected.length;
      const pageItems = candidates.slice(0, room);
      const fastRange = settings.rangeSelection && pageItems.length > 1 && !visibleProcessedItems();
      if (fastRange) {
        if (!selected.length) await trustedClick(pageItems[0].checkbox, false);
        await trustedClick(pageItems.at(-1).checkbox, true);
      }
      for (const item of pageItems) {
        if (selected.length >= settings.batchSize || stopped) break;
        if (item.checkbox.getAttribute("aria-checked") !== "true") await trustedClick(item.checkbox, false);
        if (item.checkbox.getAttribute("aria-checked") === "true") {
          selected.push(item);
          report("selecting", `Selezionato elemento ${selected.length} del lotto`, {
            phaseLabel: "Selezione dalla timeline", selected: selected.length,
            batchPercent: selected.length / settings.batchSize * 100,
            batchLabel: `Lotto: ${selected.length} / ${settings.batchSize}`,
            detail: `ID ${item.id} · ${processed.size} già archiviati · ${fastRange?"Maiusc+click":"click singolo"}`
          });
        }
      }
      if (selected.length >= settings.batchSize) break;
      const advanced = await advanceTimeline(settings);
      bottomChecks = advanced ? 0 : bottomChecks + 1;
      report("scrolling", advanced ? "Timeline avanzata: caricamento della sezione successiva" : `Controllo fine timeline ${bottomChecks}/5`, {
        phaseLabel:"Scansione timeline",selected:selected.length,batchPercent:selected.length/settings.batchSize*100,
        batchLabel:`Lotto: ${selected.length} / ${settings.batchSize}`,
        detail:`posizione ${Math.round(scrollPosition(timelineScroller()))} px · ${observed.size} ID individuati`
      });
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
    try {
      const prepared = await chrome.runtime.sendMessage({type:"prepareAutomation"});
      if (!prepared?.ok) throw new Error(prepared?.error || "Impossibile mantenere attiva la scheda Google Foto");
      rewindTimeline();
      await sleep(settings.settleSeconds * 1000);
      report("starting", "Scansione della timeline dall'inizio", {phaseLabel:"Preparazione",batchPercent:0,batchLabel:"Lotto non ancora iniziato",detail:`Registro: ${processed.size} elementi già completati · modalità focus in background attiva`});
      while (!stopped) {
        const batch = await selectBatch(settings);
        if (!batch.length) {
          if (!observed.size) throw new Error("Nessuna tessera riconosciuta: la struttura di Google Foto potrebbe essere cambiata");
          report("complete", "Backup della timeline completato", {selected:0,processPercent:100,batchPercent:100,phaseLabel:"Completato",detail:`${processed.size} archiviati · ${observed.size} ID osservati`});
          break;
        }
        report("requesting-download", `Richiesta ZIP per ${batch.length} elementi`, {selected:batch.length,batchPercent:100,phaseLabel:"Avvio download",detail:`ID da ${batch[0].id} a ${batch.at(-1).id}`});
        const completion = waitForBatch();
        const response = await chrome.runtime.sendMessage({type: "downloadBatch", count: batch.length, photoIds: batch.map(item => item.id), settings});
        if (!response?.ok) throw new Error(response?.error || "Download non avviato");
        await completion;
        await saveCompleted(batch);
        const moved=completion.moved||{};
        const examples=(moved.files||[]).slice(0,3).map(file=>file.file).join(", ");
        report("batch-complete", `Estratti ${moved.fileCount||batch.length} file sul My Cloud`, {selected:batch.length,processPercent:100,batchPercent:100,phaseLabel:"Lotto completato",detail:`${processed.size} elementi registrati · cartella ${moved.extractedFolder||settings.extractedFolder}${examples?` · ${examples}`:""}`});
        await clearSelection();
      }
    } catch (error) {
      report("error", error.message || String(error));
      await clearSelection();
    } finally {
      running = false;
      await chrome.runtime.sendMessage({type:"releaseAutomation"}).catch(()=>{});
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "start") { start(message.settings); respond({ok: true}); }
    if (message.type === "stop") { stopped = true; respond({ok: true}); }
  });
})();
