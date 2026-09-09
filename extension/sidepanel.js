"use strict";
const ids = ["destination", "extractedFolder", "downloadRoot", "batchSize", "clickDelayMs", "settleSeconds", "verifyCopies", "keepArchives"];
const el = id => document.getElementById(id);
const settings = () => GPhotoPlanner.clampSettings(Object.fromEntries(ids.map(id => [id, el(id).type === "checkbox" ? el(id).checked : el(id).value])));
const phaseProgress = {starting:5, selecting:20, scrolling:24, "requesting-download":30, downloading:50, extracting:75, "batch-complete":100, complete:100, error:0};

function addLog(level, message, details="") {
  el("log").querySelector(".empty-log")?.remove();
  const row=document.createElement("div"); row.className="log-row";
  const time=document.createElement("span"); time.className="log-time"; time.textContent=new Date().toLocaleTimeString();
  const kind=document.createElement("span"); kind.className=`log-level ${level}`; kind.textContent=level.toUpperCase();
  const text=document.createElement("span"); text.className="log-detail"; text.textContent=details ? `${message} · ${details}` : message;
  row.append(time,kind,text); el("log").prepend(row);
  while(el("log").children.length>250) el("log").lastElementChild.remove();
}
function setProgress(id, percent) { const value=Math.max(0,Math.min(100,Math.round(percent||0))); el(`${id}Progress`).value=value; el(`${id}Percent`).textContent=`${value}%`; }
function setRunning(value) { el("start").disabled=value; el("stop").disabled=!value; el("dot").className=value?"active":""; el("runBadge").className=`badge ${value?"active":""}`; el("runBadge").textContent=value?"IN ESECUZIONE":"PRONTO"; }
async function photosTab(){const tabs=await chrome.tabs.query({url:"https://photos.google.com/*"});if(!tabs.length)throw new Error("Apri Google Foto in Chrome per iniziare.");return tabs.find(tab=>tab.active)||tabs[0];}

chrome.storage.local.get("settings",result=>{if(!result.settings)return;for(const id of ids){if(el(id).type==="checkbox")el(id).checked=result.settings[id];else el(id).value=result.settings[id];}});
el("check").onclick=async()=>{const cfg=settings();chrome.storage.local.set({settings:cfg});addLog("info","Controllo volume",cfg.destination);const response=await chrome.runtime.sendMessage({type:"hostStatus",destination:cfg.destination});el("disk").textContent=response.ok?`✓ Disponibile · ${response.freeHuman} liberi`:`✕ ${response.error}`;addLog(response.ok?"success":"error",response.ok?"Destinazione pronta":"Destinazione non disponibile",response.ok?`${response.freeHuman} liberi`:response.error);};
el("start").onclick=async()=>{try{const cfg=settings();chrome.storage.local.set({settings:cfg});const host=await chrome.runtime.sendMessage({type:"hostStatus",destination:cfg.destination});if(!host.ok)throw new Error(host.error);const tab=await photosTab();await chrome.storage.session.set({automationTabId:tab.id});setRunning(true);setProgress("process",5);addLog("info","Backup avviato",`scheda ${tab.id}, lotti da ${cfg.batchSize}`);await chrome.tabs.sendMessage(tab.id,{type:"start",settings:cfg});}catch(error){el("dot").className="error";el("message").textContent=error.message;el("runBadge").className="badge error";el("runBadge").textContent="ERRORE";addLog("error","Avvio fallito",error.message);}};
el("stop").onclick=async()=>{const{automationTabId}=await chrome.storage.session.get("automationTabId");if(automationTabId)await chrome.tabs.sendMessage(automationTabId,{type:"stop"}).catch(()=>{});setRunning(false);addLog("info","Interruzione richiesta","il lotto in corso viene lasciato recuperabile");};
el("reset").onclick=async()=>{if(!confirm("Azzerare il registro? Tutte le foto saranno considerate nuovamente."))return;await chrome.storage.local.remove("completedPhotoIds");addLog("success","Registro elementi azzerato");};
el("clearLog").onclick=()=>{el("log").replaceChildren(Object.assign(document.createElement("div"),{className:"empty-log",textContent:"Registro pulito."}));};
chrome.runtime.onMessage.addListener(message=>{if(message.type!=="progress-ui")return;el("phase").textContent=message.phaseLabel||message.phase;el("message").textContent=message.message;el("selectedStat").textContent=message.selected??el("selectedStat").textContent;el("processedStat").textContent=message.processed??el("processedStat").textContent;el("discoveredStat").textContent=message.discovered??el("discoveredStat").textContent;setProgress("process",message.processPercent??phaseProgress[message.phase]);if(message.batchPercent!==undefined)setProgress("batch",message.batchPercent);if(message.batchLabel)el("batchLabel").textContent=message.batchLabel;addLog(message.level||(message.phase==="error"?"error":message.phase==="complete"||message.phase==="batch-complete"?"success":"info"),message.message,message.detail||"");if(message.phase==="complete"||message.phase==="error")setRunning(false);if(message.phase==="error"){el("dot").className="error";el("runBadge").className="badge error";el("runBadge").textContent="ERRORE";}});
