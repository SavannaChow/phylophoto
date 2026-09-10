"use strict";

import { buildFolderIndex, collectTips, extractNewick, matchFolders, mrcaDescendants, parseCsv, parseNewick, transformBranchLengths } from "./core.mjs";

const byId = id => document.getElementById(id);
const ids = ["tree-file","photo-folder","metadata-file","clear-tree","workspace","tree-name","tree-viewer","tree-empty","tree-panel","photo-panel","selection-summary","metadata-results","photo-results","splitter","tip-search","tip-options","select-tip","save-visual-options","reset-tree-view","photo-folder-name","match-rule","delimiter-wrap","delimiter","prefix-count-wrap","prefix-count","regex-wrap","match-regex","comparison-mode","case-sensitive","rooting-mode","single-outgroup-wrap","single-outgroup","multiple-outgroups-wrap","multiple-outgroups","apply-root","rooting-status","folder-warning-panel","folder-warning-summary","folder-warning-rows"];
const ui = Object.fromEntries(ids.map(id => [id, byId(id)]));
const state = { controller: null, unsubscribe: null, sourceTree: "", filename: "", parsedTree: null, tips: [], selectedTips: [], files: [], folderIndex: new Map(), folderMatches: new Map(), imageUrls: [], metadata: null, metadataTipColumn: "", appliedRoot: null };

function matchingOptions() {
  return { rule: ui["match-rule"].value, delimiter: ui.delimiter.value, fieldCount: Number(ui["prefix-count"].value), pattern: ui["match-regex"].value, comparison: ui["comparison-mode"].value, caseSensitive: ui["case-sensitive"].checked };
}
function panelPercent() { const width = ui.workspace.getBoundingClientRect().width; return width ? ui["tree-panel"].getBoundingClientRect().width / width * 100 : 56; }
function setPanelPercent(percent) { ui.workspace.style.gridTemplateColumns = `minmax(300px,${percent}fr) 10px minmax(300px,${100 - percent}fr)`; ui.splitter.setAttribute("aria-valuenow", Math.round(percent)); }
function saveUiPreferences() { localStorage.setItem("phylophoto-client-ui", JSON.stringify({ panel: panelPercent(), matching: matchingOptions() })); }
function restoreUiPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem("phylophoto-client-ui") || "{}"), matching = saved.matching || {};
    if (saved.panel >= 25 && saved.panel <= 75) setPanelPercent(saved.panel);
    if (["full","prefix","regex"].includes(matching.rule)) ui["match-rule"].value = matching.rule;
    if (typeof matching.delimiter === "string") ui.delimiter.value = matching.delimiter;
    if (Number(matching.fieldCount) >= 1) ui["prefix-count"].value = matching.fieldCount;
    if (typeof matching.pattern === "string") ui["match-regex"].value = matching.pattern;
    if (["equals","starts"].includes(matching.comparison)) ui["comparison-mode"].value = matching.comparison;
    ui["case-sensitive"].checked = Boolean(matching.caseSensitive);
  } catch { localStorage.removeItem("phylophoto-client-ui"); }
  updateMatchingControls();
}
function showStatus(message, warning = false) { ui["rooting-status"].textContent = message; ui["rooting-status"].classList.toggle("warning", warning); ui["rooting-status"].hidden = !message; }
function revokeImages() { state.imageUrls.forEach(URL.revokeObjectURL); state.imageUrls = []; }

function updateFolderMatches() {
  try {
    const matches = matchFolders(state.tips, state.folderIndex, matchingOptions());
    state.folderMatches = new Map(matches.map(match => [match.tip, match]));
    const warnings = matches.filter(match => match.status !== "matched");
    ui["folder-warning-panel"].hidden = !state.files.length;
    ui["folder-warning-summary"].textContent = `Folder warnings (${warnings.length})`;
    ui["folder-warning-rows"].replaceChildren(...warnings.map(match => {
      const row = document.createElement("tr");
      [match.tip,match.key,match.status,match.candidates.join(", ")].forEach(value => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
      return row;
    }));
    renderPhotos(); saveUiPreferences();
  } catch (error) { ui["folder-warning-panel"].hidden = false; ui["folder-warning-summary"].textContent = `Folder matching error — ${error.message || error}`; }
}

function renderMetadata() {
  ui["metadata-results"].replaceChildren();
  if (!state.metadata || !state.selectedTips.length || !state.metadataTipColumn) { ui["metadata-results"].hidden = true; return; }
  const rows = state.metadata.rows.filter(row => state.selectedTips.includes(row[state.metadataTipColumn]));
  if (!rows.length) { ui["metadata-results"].hidden = true; return; }
  const fragment = byId("metadata-table-template").content.cloneNode(true);
  fragment.querySelector("summary").textContent = `Metadata rows (${rows.length})`;
  const headRow = document.createElement("tr");
  state.metadata.headers.forEach(header => { const th = document.createElement("th"); th.textContent = header; headRow.append(th); });
  fragment.querySelector("thead").append(headRow);
  rows.forEach(data => { const tr = document.createElement("tr"); state.metadata.headers.forEach(header => { const td = document.createElement("td"); td.textContent = data[header]; tr.append(td); }); fragment.querySelector("tbody").append(tr); });
  ui["metadata-results"].append(fragment); ui["metadata-results"].hidden = false;
}

function renderPhotos() {
  revokeImages(); ui["photo-results"].replaceChildren();
  ui["selection-summary"].textContent = state.selectedTips.length === 1 ? `Tip — ${state.selectedTips[0]}` : state.selectedTips.length ? `Selected node — ${state.selectedTips.length} descendant tips` : "";
  renderMetadata();
  if (!state.selectedTips.length || !state.files.length) return;
  let count = 0;
  for (const tip of state.selectedTips) {
    const match = state.folderMatches.get(tip), files = match?.folder ? state.folderIndex.get(match.folder) || [] : [];
    if (!files.length) continue;
    count += files.length;
    const article = byId("photo-group-template").content.firstElementChild.cloneNode(true); article.querySelector("h2").textContent = tip;
    const stack = article.querySelector(".photo-stack");
    for (const file of files) {
      const figure = document.createElement("figure"), image = document.createElement("img"), caption = document.createElement("figcaption"), url = URL.createObjectURL(file);
      state.imageUrls.push(url); image.src = url; image.alt = file.name; caption.textContent = file.webkitRelativePath || file.name; figure.append(image,caption); stack.append(figure);
    }
    ui["photo-results"].append(article);
  }
  if (!count) { const note = document.createElement("p"); note.className = "empty-note"; note.textContent = "No photos in the matched folder."; ui["photo-results"].append(note); }
}
function setSelection(names) { state.selectedTips = [...new Set((Array.isArray(names) ? names : []).filter(name => state.tips.includes(name)))]; renderPhotos(); }
function requestPearTreeSelection(names) { if (!state.controller) return; state.controller.getSelectionChangedListener()(names?.length ? names : null); setSelection(names || []); }

async function rerootButton() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = ui["tree-viewer"].querySelector("#btn-reroot");
    if (button && !button.disabled) return button;
    await new Promise(resolve => window.setTimeout(resolve,50));
  }
  return null;
}

function currentRootRequest() {
  const mode = ui["rooting-mode"].value;
  if (mode === "original" || mode === "midpoint") return { mode, names: [] };
  const names = mode === "single" ? [ui["single-outgroup"].value.trim()].filter(Boolean) : ui["multiple-outgroups"].value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
  return { mode, names: [...new Set(names)] };
}
async function applyRoot(request = currentRootRequest(), report = true) {
  if (!state.controller) return;
  try {
    if (request.mode === "original") { state.appliedRoot = null; await mountTree(); if (report) showStatus("Restored the originally loaded root."); return; }
    if (request.mode === "midpoint") { state.controller.midpointRoot(); state.appliedRoot = request; if (report) showStatus("PearTree applied midpoint rooting."); return; }
    const names = request.names, missing = names.filter(name => !state.tips.includes(name));
    if (missing.length) throw new Error(`Outgroup tip(s) not found: ${missing.join(", ")}`);
    if (request.mode === "single" && names.length !== 1) throw new Error("Choose exactly one outgroup tip.");
    if (request.mode === "multiple" && names.length < 2) throw new Error("Choose at least two outgroup tips.");
    requestPearTreeSelection(names);
    const button = await rerootButton();
    if (!button) throw new Error("PearTree could not reroot on this selection.");
    button.click(); state.appliedRoot = request;
    if (report && request.mode === "multiple") {
      const descendants = mrcaDescendants(state.parsedTree,names), unexpected = descendants.filter(name => !names.includes(name));
      showStatus(unexpected.length ? `PearTree rooted by the selected MRCA. Additional MRCA descendants (${unexpected.length}):\n${unexpected.join("\n")}` : "PearTree rooted by the selected monophyletic outgroup.", unexpected.length > 0);
    } else if (report) showStatus("PearTree applied the selected outgroup root.");
  } catch (error) { showStatus(error.message || String(error),true); }
}

async function mountTree() {
  if (!state.sourceTree) return;
  const mode = document.querySelector('input[name="branch-mode"]:checked').value, tree = transformBranchLengths(state.parsedTree,mode) || state.sourceTree;
  let settings = state.controller?.getSettings?.() || {};
  if (!Object.keys(settings).length) {
    try { settings = JSON.parse(localStorage.getItem("phylophoto-client-saved-visual-settings") || "{}"); } catch { settings = {}; }
  }
  state.unsubscribe?.(); state.controller?.destroy?.(); ui["tree-viewer"].replaceChildren();
  state.controller = await window.PearTreeEmbed.embed({
    container: ui["tree-viewer"], tree, filename: state.filename, nodeLabelName: "bootstrap", storageKey: "phylophoto-client-peartree-settings", height: "100%",
    settings: { branchLabelAnnotation: "bootstrap", introAnimation: "none", paddingLeft: "4", paddingRight: "4", paddingTop: "4", paddingBottom: "4", ...settings }, paletteSections: "all",
    appSections: ["toolbar","canvasContainer","statusBar","modals","palette"], ui: { theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", palette: true, toolbar: true, statusBar: true, openTree: false, import: false, export: false, rtt: false, dataTable: false, help: false, about: false, brand: false, toolbarSections: "all" }
  });
  state.unsubscribe = state.controller.onSelectionChanged(setSelection); ui["tree-empty"].hidden = true;
  if (state.appliedRoot) window.setTimeout(() => applyRoot(state.appliedRoot,false),50);
}

async function loadTree(file) {
  if (!file) return;
  try {
    state.sourceTree = extractNewick(await file.text()); state.parsedTree = parseNewick(state.sourceTree); state.tips = collectTips(state.parsedTree); state.filename = file.name; state.appliedRoot = null;
    ui["tree-name"].textContent = file.name;
    for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","select-tip"]) ui[id].disabled = false;
    ui["tip-options"].replaceChildren(...state.tips.map(name => { const option = document.createElement("option"); option.value = name; return option; }));
    await mountTree(); updateFolderMatches(); setSelection([]); showStatus("");
  } catch (error) { ui["tree-empty"].hidden = false; ui["tree-empty"].textContent = `Could not open tree: ${error.message || error}`; }
}
function clearTree() {
  state.unsubscribe?.(); state.controller?.destroy?.(); revokeImages(); Object.assign(state,{ controller:null,unsubscribe:null,sourceTree:"",filename:"",parsedTree:null,tips:[],selectedTips:[],files:[],folderIndex:new Map(),folderMatches:new Map(),metadata:null,metadataTipColumn:"",appliedRoot:null });
  ui["tree-viewer"].replaceChildren(); ui["tree-empty"].replaceChildren(); const label = document.createElement("label"); label.className = "button primary"; label.htmlFor = "tree-file"; label.textContent = "Open a tree"; ui["tree-empty"].append(label); ui["tree-empty"].hidden = false;
  ui["photo-results"].replaceChildren(); ui["metadata-results"].replaceChildren(); ui["selection-summary"].textContent = ""; ui["tree-name"].textContent = ""; ui["photo-folder-name"].textContent = ""; ui["folder-warning-panel"].hidden = true; showStatus("");
  for (const id of ["tree-file","photo-folder","metadata-file"]) ui[id].value = "";
  for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","select-tip"]) ui[id].disabled = true;
}
function updateMatchingControls() { const rule = ui["match-rule"].value; ui["delimiter-wrap"].hidden = rule !== "prefix"; ui["prefix-count-wrap"].hidden = rule !== "prefix"; ui["regex-wrap"].hidden = rule !== "regex"; }
function updateRootingControls() { const mode = ui["rooting-mode"].value; ui["single-outgroup-wrap"].hidden = mode !== "single"; ui["multiple-outgroups-wrap"].hidden = mode !== "multiple"; }
function startSplit(event) {
  event.preventDefault(); ui.splitter.classList.add("dragging"); document.body.classList.add("dragging");
  const move = moveEvent => { const rect = ui.workspace.getBoundingClientRect(); setPanelPercent(Math.min(75,Math.max(25,(moveEvent.clientX - rect.left) / rect.width * 100))); };
  const stop = () => { ui.splitter.classList.remove("dragging"); document.body.classList.remove("dragging"); window.removeEventListener("pointermove",move); saveUiPreferences(); window.dispatchEvent(new Event("resize")); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",stop,{ once:true });
}

ui["tree-file"].addEventListener("change",event => loadTree(event.target.files[0]));
ui["photo-folder"].addEventListener("change",event => { state.files = [...event.target.files]; state.folderIndex = buildFolderIndex(state.files); ui["photo-folder-name"].textContent = state.files[0]?.webkitRelativePath?.split("/")[0] || ""; updateFolderMatches(); });
ui["metadata-file"].addEventListener("change",async event => { const file = event.target.files[0]; if (!file) return; state.metadata = parseCsv(await file.text()); state.metadataTipColumn = state.metadata.headers.find(header => state.metadata.rows.some(row => state.tips.includes(row[header]))) || state.metadata.headers[0] || ""; renderMetadata(); });
ui["clear-tree"].addEventListener("click",clearTree);
ui["select-tip"].addEventListener("click",() => { const name = ui["tip-search"].value.trim(); if (!state.tips.includes(name)) return showStatus(`Tip not found: ${name}`,true); requestPearTreeSelection([name]); showStatus(""); });
document.querySelectorAll('input[name="branch-mode"]').forEach(input => input.addEventListener("change",mountTree));
ui["save-visual-options"].addEventListener("click",() => {
  const settings = state.controller?.getSettings?.() || {};
  localStorage.setItem("phylophoto-client-saved-visual-settings",JSON.stringify(settings));
  const original = ui["save-visual-options"].textContent; ui["save-visual-options"].textContent = "Saved"; window.setTimeout(() => { ui["save-visual-options"].textContent = original; },1000);
});
ui["reset-tree-view"].addEventListener("click",() => {
  localStorage.removeItem("phylophoto-client-peartree-settings"); localStorage.removeItem("phylophoto-client-saved-visual-settings");
  state.unsubscribe?.(); state.controller?.destroy?.(); state.unsubscribe = null; state.controller = null;
  if (state.sourceTree) mountTree();
});
for (const id of ["match-rule","delimiter","prefix-count","match-regex","comparison-mode","case-sensitive"]) ui[id].addEventListener("change",() => { updateMatchingControls(); updateFolderMatches(); });
ui["rooting-mode"].addEventListener("change",updateRootingControls); ui["apply-root"].addEventListener("click",() => applyRoot()); ui.splitter.addEventListener("pointerdown",startSplit);
ui.splitter.addEventListener("keydown",event => { if (!["ArrowLeft","ArrowRight"].includes(event.key)) return; event.preventDefault(); setPanelPercent(Math.min(75,Math.max(25,panelPercent() + (event.key === "ArrowRight" ? 2 : -2)))); saveUiPreferences(); });
window.addEventListener("beforeunload",revokeImages); restoreUiPreferences(); updateRootingControls();
