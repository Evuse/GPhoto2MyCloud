(() => {
  "use strict";
  if (globalThis.__gphoto2mycloudAutomationLoaded) return;
  globalThis.__gphoto2mycloudAutomationLoaded = true;
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

  function captureResumeAnchor(lastPhotoId = null) {
    const scroller = timelineScroller();
    const top = scrollPosition(scroller);
    return {
      version: 1,
      photoId: lastPhotoId,
      scrollTop: Math.max(0, Math.round(top)),
      scrollHeight: Math.max(1, Math.round(scroller.scrollHeight)),
      viewportHeight: Math.max(1, Math.round(scroller.clientHeight || innerHeight)),
      ratio: Math.max(0, Math.min(1, top / Math.max(1, scroller.scrollHeight - (scroller.clientHeight || innerHeight))))
    };
  }

  async function restoreResumeAnchor(anchor, settings) {
    if (!anchor || !Number.isFinite(Number(anchor.scrollTop))) return false;
    const scroller = timelineScroller();
    const currentHeight = Math.max(1, scroller.scrollHeight);
    const oldHeight = Math.max(1, Number(anchor.scrollHeight));
    const comparableLayout = Math.abs(currentHeight - oldHeight) / oldHeight < 0.12;
    const rawTarget = comparableLayout
      ? Number(anchor.scrollTop)
      : Number(anchor.ratio || 0) * Math.max(0, currentHeight - (scroller.clientHeight || innerHeight));
    // Riparti qualche schermata prima del checkpoint: è immediato, ma evita di
    // saltare elementi se Chrome, zoom o la griglia hanno cambiato geometria.
    const safetyMargin = Math.max(Number(anchor.viewportHeight) || innerHeight, scroller.clientHeight || innerHeight) * 4;
    const target = Math.max(0, rawTarget - safetyMargin);
    if (scroller === document.scrollingElement) scrollTo(0, target);
    else { scroller.scrollTop = target; scroller.dispatchEvent(new Event("scroll", {bubbles:true})); }
    await sleep(Math.min(3, settings.settleSeconds) * 1000);
    report("resuming", "Posizione salvata sul My Cloud ripristinata", {phaseLabel:"Salto immediato al checkpoint",processPercent:7,batchPercent:0,detail:`${Math.round(target)} px · margine di sicurezza 4 schermate`});
    return true;
  }

  async function seekResumePoint(lastPhotoId, settings, resumeAnchor = null) {
    // Prima prova la posizione corrente (utile durante aggiornamenti e retry), poi
    // effettua un singolo salto al punto persistito. Non scorre più dalla prima foto.
    const visibleNow = [...document.querySelectorAll('a[href*="/photo/"]')]
      .some(item => GPhotoPlanner.photoId(item.href, location.href) === lastPhotoId);
    if (!visibleNow && resumeAnchor) await restoreResumeAnchor(resumeAnchor, settings);
    if (!lastPhotoId) return false;
    await sleep(Math.min(3, settings.settleSeconds) * 1000);
    let bottomChecks = 0;
    let screens = 0;
    while (!stopped && bottomChecks < 4 && screens < 12) {
      const link = [...document.querySelectorAll('a[href*="/photo/"]')]
        .find(item => GPhotoPlanner.photoId(item.href, location.href) === lastPhotoId);
      if (link) {
        const scroller = timelineScroller();
        const scrollerTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
        // Keep the checkpoint row visible: items later in the same row may not have
        // belonged to the completed batch and must never be skipped.
        const nextPosition = scrollPosition(scroller) + Math.max(0, link.getBoundingClientRect().top - scrollerTop);
        if (scroller === document.scrollingElement) scrollTo(0, nextPosition);
        else { scroller.scrollTop = nextPosition; scroller.dispatchEvent(new Event("scroll", {bubbles:true})); }
        await sleep(Math.min(3, settings.settleSeconds) * 1000);
        report("resuming", "Checkpoint My Cloud raggiunto", {phaseLabel:"Ripresa dal punto salvato",processPercent:8,batchPercent:0,detail:`Ultimo ID completato ${lastPhotoId} · ${screens} schermate saltate`});
        return true;
      }
      screens += 1;
      const advanced = await advanceTimeline({...settings, settleSeconds:Math.min(3, settings.settleSeconds)});
      bottomChecks = advanced ? 0 : bottomChecks + 1;
      if (screens % 10 === 0) report("resuming", "Ricerca del checkpoint sul My Cloud", {phaseLabel:"Avanzamento rapido",processPercent:5,batchPercent:0,detail:`${screens} schermate saltate · cerco ${lastPhotoId}`});
    }
    rewindTimeline();
    report("recovering", "Checkpoint non visibile vicino alla posizione salvata", {phaseLabel:"Fallback sicuro",processPercent:3,batchPercent:0,detail:"Geometria della griglia cambiata: scansione dall'inizio per non saltare elementi"});
    return false;
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

  async function trustedClick(checkbox) {
    const box = checkbox.getBoundingClientRect();
    const response = await chrome.runtime.sendMessage({
      type: "trustedClick", x: box.left + box.width / 2, y: box.top + box.height / 2
    });
    if (!response?.ok) throw new Error(response?.error || "Click Chrome non riuscito");
    await sleep(settingsForClickDelay);
  }

  let settingsForClickDelay = 350;

  async function selectBatch(settings) {
    selected = [];
    settingsForClickDelay = settings.clickDelayMs;
    let bottomChecks = 0;
    while (!stopped && selected.length < settings.batchSize && bottomChecks < 5) {
      const candidates = visiblePhotoCheckboxes().filter(item => !selected.some(value => value.id === item.id));
      const pageItems = candidates.slice(0, settings.batchSize - selected.length);
      for (const item of pageItems) {
        if (selected.length >= settings.batchSize || stopped) break;
        if (item.checkbox.getAttribute("aria-checked") !== "true") await trustedClick(item.checkbox);
        if (item.checkbox.getAttribute("aria-checked") === "true") {
          selected.push(item);
          report("selecting", `Selezionato elemento ${selected.length} del lotto`, {
            phaseLabel: "Selezione dalla timeline", selected: selected.length,
            batchPercent: selected.length / settings.batchSize * 100,
            batchLabel: `Lotto: ${selected.length} / ${settings.batchSize}`,
            detail: `ID ${item.id} · ${processed.size} già archiviati · selezione verificata`
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
    const settings = GPhotoPlanner.clampSettings(rawSettings);
    let restartAfterUnexpectedError = false;
    try {
      let preparationFailures = 0;
      while (!stopped) {
        const prepared = await chrome.runtime.sendMessage({type:"prepareAutomation"}).catch(error => ({ok:false,error:error.message}));
        if (prepared?.ok) break;
        preparationFailures += 1;
        const delay = Math.min(300, settings.retryDelaySeconds * (2 ** Math.min(5, preparationFailures - 1)));
        report("recovering", "Preparazione non riuscita: nuovo tentativo automatico", {level:"error",phaseLabel:"Connessione a Chrome",processPercent:1,batchPercent:0,detail:`${prepared?.error || "errore sconosciuto"} · retry tra ${delay}s`});
        await sleep(delay * 1000);
      }
      if (stopped) return;
      report("starting", "Lettura del checkpoint dal My Cloud", {phaseLabel:"Sincronizzazione registro",batchPercent:0,batchLabel:"Lotto non ancora iniziato"});
      const checkpoint = await chrome.runtime.sendMessage({type:"syncCheckpoint",destination:settings.destination});
      if (!checkpoint?.ok) throw new Error(checkpoint?.error || "Checkpoint My Cloud non disponibile");
      processed = new Set((await chrome.storage.local.get("completedPhotoIds")).completedPhotoIds || []);
      const resumed = await seekResumePoint(checkpoint.lastPhotoId, settings, checkpoint.resumeAnchor);
      if (!resumed) await sleep(settings.settleSeconds * 1000);
      report("starting", resumed ? "Ripresa dopo l'ultimo elemento archiviato" : "Scansione della timeline dall'inizio", {phaseLabel:"Preparazione completata",batchPercent:0,batchLabel:"Lotto non ancora iniziato",detail:`My Cloud: ${checkpoint.nasCount} ID · registro unificato: ${processed.size} · modalità background attiva`});
      let effectiveBatchSize = settings.batchSize;
      let consecutiveFailures = 0;
      while (!stopped) {
        try {
          const attemptSettings = {...settings, batchSize: effectiveBatchSize};
          const batch = await selectBatch(attemptSettings);
          if (!batch.length) {
            if (!observed.size) throw new Error("Nessuna tessera riconosciuta: la pagina non è ancora pronta");
            const unresolved = [...observed].filter(id => !processed.has(id));
            if (unresolved.length) throw new Error(`${unresolved.length} elementi individuati non sono stati selezionati`);
            report("complete", "Backup della timeline completato", {selected:0,processPercent:100,batchPercent:100,phaseLabel:"Completato",detail:`${processed.size} archiviati · ${observed.size} ID osservati`});
            break;
          }
          report("requesting-download", `Richiesta ZIP per ${batch.length} elementi`, {selected:batch.length,batchPercent:100,phaseLabel:"Avvio download",detail:`Tentativo con lotto ${effectiveBatchSize} · ID da ${batch[0].id} a ${batch.at(-1).id}`});
          const completion = waitForBatch();
          const resumeAnchor = captureResumeAnchor(batch.at(-1)?.id);
          const response = await chrome.runtime.sendMessage({type: "downloadBatch", count: batch.length, photoIds: batch.map(item => item.id), resumeAnchor, settings});
          if (!response?.ok) throw new Error(response?.error || "Download non avviato");
          await completion;
          await saveCompleted(batch);
          const moved=completion.moved||{};
          const examples=(moved.files||[]).slice(0,3).map(file=>file.file).join(", ");
          report("batch-complete", `Estratti ${moved.fileCount||batch.length} file sul My Cloud`, {selected:batch.length,processPercent:100,batchPercent:100,phaseLabel:"Lotto completato",detail:`${processed.size} elementi registrati · cartella ${moved.extractedFolder||settings.extractedFolder}${examples?` · ${examples}`:""}`});
          await clearSelection();
          consecutiveFailures = 0;
          effectiveBatchSize = GPhotoPlanner.batchAfterSuccess(effectiveBatchSize, settings.batchSize);
        } catch (error) {
          if (stopped) break;
          consecutiveFailures += 1;
          const retry = GPhotoPlanner.retryAfterFailure(effectiveBatchSize, consecutiveFailures, settings.retryDelaySeconds);
          effectiveBatchSize = retry.batchSize;
          const delay = retry.delaySeconds;
          report("recovering", "Errore recuperabile: sincronizzazione non interrotta", {
            level:"error", phaseLabel:"Ripristino automatico", processPercent:3, batchPercent:0,
            batchLabel:`Nuovo lotto: ${effectiveBatchSize}`, detail:`${error.message || error} · nuovo tentativo tra ${delay}s`
          });
          await clearSelection();
          observed = new Set();
          await sleep(delay * 1000);
          const latest = await chrome.runtime.sendMessage({type:"syncCheckpoint",destination:settings.destination}).catch(() => null);
          if (latest?.ok) {
            processed = new Set((await chrome.storage.local.get("completedPhotoIds")).completedPhotoIds || []);
            await seekResumePoint(latest.lastPhotoId, settings, latest.resumeAnchor);
          } else {
            rewindTimeline();
          }
        }
      }
    } catch (error) {
      if (!stopped) {
        restartAfterUnexpectedError = true;
        report("recovering", "Errore imprevisto: riavvio automatico richiesto", {level:"error",phaseLabel:"Ripristino",detail:`${error.message || error} · retry tra ${settings.retryDelaySeconds}s`});
      }
    } finally {
      running = false;
      await chrome.runtime.sendMessage({type:"releaseAutomation"}).catch(()=>{});
      if (restartAfterUnexpectedError && !stopped) {
        await sleep(settings.retryDelaySeconds * 1000);
        if (!stopped) start(rawSettings);
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "pingAutomation") { respond({ok: true, version: chrome.runtime.getManifest().version}); }
    if (message.type === "start") { start(message.settings); respond({ok: true}); }
    if (message.type === "stop") { stopped = true; respond({ok: true}); }
  });
})();
