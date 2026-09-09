"use strict";
const ids = ["destination", "downloadRoot", "batchSize", "clickDelayMs", "settleSeconds", "verifyCopies"];
const el = id => document.getElementById(id);
const settings = () => GPhotoPlanner.clampSettings(Object.fromEntries(ids.map(id => [id, el(id).type === "checkbox" ? el(id).checked : el(id).value])));
function log(message) { el("log").textContent = `${new Date().toLocaleTimeString()}  ${message}\n${el("log").textContent}`; }
function setRunning(value) { el("start").disabled = value; el("stop").disabled = !value; el("dot").className = value ? "active" : ""; }
async function activePhotosTab() { const [tab] = await chrome.tabs.query({active: true, currentWindow: true}); if (!tab?.url?.startsWith("https://photos.google.com/")) throw new Error("Apri Google Foto nella scheda attiva."); return tab; }
chrome.storage.local.get("settings", result => { if (!result.settings) return; for (const id of ids) { if (el(id).type === "checkbox") el(id).checked = result.settings[id]; else el(id).value = result.settings[id]; } });
el("check").onclick = async () => { const cfg=settings(); chrome.storage.local.set({settings:cfg}); const response=await chrome.runtime.sendMessage({type:"hostStatus",destination:cfg.destination}); el("disk").textContent=response.ok ? `✓ Disco disponibile · ${response.freeHuman} liberi` : `Errore: ${response.error}`; };
el("start").onclick = async () => { try { const cfg=settings(); chrome.storage.local.set({settings:cfg}); const host=await chrome.runtime.sendMessage({type:"hostStatus",destination:cfg.destination}); if(!host.ok) throw new Error(host.error); const tab=await activePhotosTab(); setRunning(true); await chrome.tabs.sendMessage(tab.id,{type:"start",settings:cfg}); } catch(error){ el("dot").className="error"; el("message").textContent=error.message; log(error.message); } };
el("stop").onclick = async () => { const tab=await activePhotosTab(); await chrome.tabs.sendMessage(tab.id,{type:"stop"}); setRunning(false); log("Interruzione richiesta"); };
chrome.runtime.onMessage.addListener(message => { if(message.type!=="progress-ui") return; el("phase").textContent=message.phase; el("message").textContent=message.message; log(message.message); if(message.phase==="complete"||message.phase==="error") setRunning(false); if(message.phase==="error") el("dot").className="error"; });
