"use strict";

import { buildFolderIndex, collectTips, extractNewick, matchFolders, mrcaDescendants, parseCsv, parseNewick, transformBranchLengths } from "./core.js";

const byId = id => document.getElementById(id);
const ids = ["tree-file","photo-folder","choose-photo-folder","refresh-photo-folder","nas-dataset","load-nas-dataset","share-dataset","nas-upload-panel","upload-dataset-id","upload-dataset-title","upload-tree-file","upload-photo-folder","upload-metadata-file","upload-dataset","upload-progress","upload-status","metadata-file","clear-tree","workspace","tree-name","tree-viewer","tree-empty","tree-panel","photo-panel","selection-summary","metadata-results","photo-results","splitter","tip-search","tip-matches","select-tip","save-visual-options","reset-tree-view","photo-folder-name","match-rule","delimiter-wrap","delimiter","prefix-count-wrap","prefix-count","regex-wrap","match-regex","comparison-mode","case-sensitive","rooting-mode","outgroup-picker","outgroup-search","outgroup-matches","outgroup-selected","multiple-outgroups","apply-root","rooting-status","folder-warning-panel","folder-warning-summary","folder-warning-rows"];
const ui = Object.fromEntries(ids.map(id => [id, byId(id)]));
const state = { viewerReady: false, loadId: 0, loadedId: 0, settingsRequest: 0, currentSettings: {}, sourceTree: "", filename: "", parsedTree: null, tips: [], selectedTips: [], files: [], photoFolderHandle: null, nasDatasetId: "", folderIndex: new Map(), folderMatches: new Map(), imageUrls: [], metadata: null, metadataTipColumn: "", appliedRoot: null, pendingRootReport: null };

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

function setPhotoFiles(files, folderName = "") {
  state.files = files;
  state.folderIndex = buildFolderIndex(files);
  ui["photo-folder-name"].textContent = folderName;
  ui["refresh-photo-folder"].disabled = !state.photoFolderHandle && !state.nasDatasetId;
  updateFolderMatches();
}

function setDatasetQuery(datasetId = "") {
  const url = new URL(window.location.href);
  if (datasetId) url.searchParams.set("dataset", datasetId);
  else url.searchParams.delete("dataset");
  history.replaceState(null, "", url);
}

function leaveNasDataset() {
  state.nasDatasetId = "";
  ui["share-dataset"].disabled = true;
  setDatasetQuery();
}

async function filesFromDirectory(handle, path = handle.name) {
  const files = [];
  for await (const entry of handle.values()) {
    const entryPath = `${path}/${entry.name}`;
    if (entry.kind === "directory") files.push(...await filesFromDirectory(entry, entryPath));
    else {
      const source = await entry.getFile();
      const file = new File([source], source.name, { type: source.type, lastModified: source.lastModified });
      Object.defineProperty(file, "webkitRelativePath", { value: entryPath });
      files.push(file);
    }
  }
  return files;
}

async function choosePhotoFolder() {
  if (!window.showDirectoryPicker) { ui["photo-folder"].click(); return; }
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    state.photoFolderHandle = handle;
    leaveNasDataset();
    setPhotoFiles(await filesFromDirectory(handle), handle.name);
  } catch (error) {
    if (error?.name !== "AbortError") showStatus(`Could not read photo folder: ${error.message || error}`, true);
  }
}

async function refreshPhotoFolder() {
  if (!state.photoFolderHandle && !state.nasDatasetId) return;
  try {
    if (state.nasDatasetId) return await loadNasDataset(state.nasDatasetId);
    const permission = await state.photoFolderHandle.queryPermission({ mode: "read" });
    if (permission !== "granted" && await state.photoFolderHandle.requestPermission({ mode: "read" }) !== "granted") throw new Error("Permission to read this photo folder was not granted.");
    setPhotoFiles(await filesFromDirectory(state.photoFolderHandle), state.photoFolderHandle.name);
  } catch (error) { showStatus(`Could not refresh photo folder: ${error.message || error}`, true); }
}

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
      const figure = document.createElement("figure"), image = document.createElement("img"), caption = document.createElement("figcaption");
      const url = file.url || URL.createObjectURL(file);
      if (!file.url) state.imageUrls.push(url); image.src = url; image.alt = file.name; caption.textContent = file.webkitRelativePath || file.name; figure.append(image,caption); stack.append(figure);
    }
    ui["photo-results"].append(article);
  }
  if (!count) { const note = document.createElement("p"); note.className = "empty-note"; note.textContent = "No photos in the matched folder."; ui["photo-results"].append(note); }
}
function setSelection(names) { state.selectedTips = [...new Set((Array.isArray(names) ? names : []).filter(name => state.tips.includes(name)))]; renderPhotos(); }
function postViewer(message) { ui["tree-viewer"].contentWindow?.postMessage(message,window.location.origin); }
function requestPearTreeSelection(names) { if (!state.viewerReady) return; postViewer({ type:"phylophoto:select",tips:names || [] }); setSelection(names || []); }
function renderTipMatches() {
  const search = ui["tip-search"].value.trim().toLocaleLowerCase();
  const matches = search ? state.tips.filter(name => name.toLocaleLowerCase().includes(search)).slice(0, 12) : [];
  ui["tip-matches"].replaceChildren(...matches.map(name => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "outgroup-match"; button.textContent = name; button.setAttribute("role", "option");
    button.addEventListener("click", () => { ui["tip-search"].value = name; ui["tip-matches"].replaceChildren(); requestPearTreeSelection([name]); showStatus(""); });
    return button;
  }));
}

function currentRootRequest() {
  const mode = ui["rooting-mode"].value;
  if (mode === "original" || mode === "midpoint") return { mode, names: [] };
  const selected = selectedOutgroups();
  const names = selected.length ? selected : [ui["outgroup-search"].value.trim()].filter(Boolean);
  return { mode, names: [...new Set(names)] };
}

function selectedOutgroups() { return [...new Set(ui["multiple-outgroups"].value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean))]; }
function setOutgroups(names) { ui["multiple-outgroups"].value = [...new Set(names)].join("\n"); }
function renderOutgroupPicker() {
  const mode = ui["rooting-mode"].value;
  const search = ui["outgroup-search"].value;
  const matches = search.trim() ? state.tips.filter(name => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).slice(0, 12) : [];
  ui["outgroup-matches"].replaceChildren(...matches.map(name => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "outgroup-match"; button.textContent = name; button.setAttribute("role", "option");
    button.addEventListener("click", () => {
      setOutgroups(mode === "single" ? [name] : [...selectedOutgroups(), name]);
      renderOutgroupPicker();
    });
    return button;
  }));
  ui["outgroup-selected"].replaceChildren(...selectedOutgroups().map(name => {
    const chip = document.createElement("span"); chip.className = "outgroup-chip";
    const text = document.createElement("span"); text.textContent = name;
    const remove = document.createElement("button"); remove.type = "button"; remove.setAttribute("aria-label", `Remove ${name}`); remove.textContent = "×";
    remove.addEventListener("click", () => {
      setOutgroups(selectedOutgroups().filter(value => value !== name));
      renderOutgroupPicker();
    });
    chip.append(text, remove); return chip;
  }));
}
async function applyRoot(request = currentRootRequest(), report = true) {
  if (!state.viewerReady || !state.sourceTree) return;
  try {
    if (request.mode === "original") { state.appliedRoot = null; await mountTree(); if (report) showStatus("Restored the originally loaded root."); return; }
    if (request.mode === "midpoint") { state.appliedRoot = request; state.pendingRootReport = report ? { message:"PearTree applied midpoint rooting.",warning:false } : null; postViewer({ type:"phylophoto:root",request }); return; }
    const names = request.names, missing = names.filter(name => !state.tips.includes(name));
    if (missing.length) throw new Error(`Outgroup tip(s) not found: ${missing.join(", ")}`);
    if (request.mode === "single" && names.length !== 1) throw new Error("Choose exactly one outgroup tip.");
    if (request.mode === "multiple" && names.length < 2) throw new Error("Choose at least two outgroup tips.");
    state.appliedRoot = request;
    if (report && request.mode === "multiple") {
      const descendants = mrcaDescendants(state.parsedTree,names), unexpected = descendants.filter(name => !names.includes(name));
      state.pendingRootReport = { message:unexpected.length ? `PearTree rooted by the selected MRCA. Additional MRCA descendants (${unexpected.length}):\n${unexpected.join("\n")}` : "PearTree rooted by the selected monophyletic outgroup.", warning:unexpected.length > 0 };
    } else state.pendingRootReport = report ? { message:"PearTree applied the selected outgroup root.",warning:false } : null;
    postViewer({ type:"phylophoto:root",request });
  } catch (error) { showStatus(error.message || String(error),true); }
}

async function mountTree() {
  if (!state.sourceTree || !state.viewerReady) return;
  const mode = document.querySelector('input[name="branch-mode"]:checked').value, tree = transformBranchLengths(state.parsedTree,mode) || state.sourceTree;
  let settings = state.currentSettings;
  if (!Object.keys(settings).length) {
    try { settings = JSON.parse(localStorage.getItem("phylophoto-client-saved-visual-settings") || "{}"); } catch { settings = {}; }
  }
  state.loadId += 1;
  postViewer({ type:"phylophoto:load-tree",tree,filename:state.filename,settings,theme:matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",loadId:state.loadId });
}

async function loadTreeText(text, filename) {
  state.sourceTree = extractNewick(text); state.parsedTree = parseNewick(state.sourceTree); state.tips = collectTips(state.parsedTree); state.filename = filename; state.appliedRoot = null;
  ui["outgroup-search"].value = ""; setOutgroups([]); renderOutgroupPicker();
  ui["tree-name"].textContent = filename;
  for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","select-tip"]) ui[id].disabled = false;
  ui["tip-search"].value = ""; renderTipMatches();
  await mountTree(); updateFolderMatches(); setSelection([]); showStatus("");
}

async function loadTree(file) {
  if (!file) return;
  leaveNasDataset();
  try { await loadTreeText(await file.text(), file.name); }
  catch (error) { ui["tree-empty"].hidden = false; ui["tree-empty"].textContent = `Could not open tree: ${error.message || error}`; }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache:"no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function loadNasDataset(datasetId) {
  if (!datasetId) return;
  ui["load-nas-dataset"].disabled = true;
  try {
    const dataset = await fetchJson(`/api/datasets/${encodeURIComponent(datasetId)}`);
    const treeResponse = await fetch(dataset.tree.url, { cache:"no-store" });
    if (!treeResponse.ok) throw new Error(`Could not read tree (${treeResponse.status})`);
    state.nasDatasetId = dataset.id; state.photoFolderHandle = null; state.files = []; state.folderIndex = new Map(); state.metadata = null; state.metadataTipColumn = "";
    await loadTreeText(await treeResponse.text(), dataset.tree.filename);
    const files = Object.entries(dataset.photoFolders || {}).flatMap(([folder, photos]) => photos.map(photo => ({ ...photo, webkitRelativePath:`nas/${folder}/${photo.path.split("/").slice(1).join("/") || photo.name}` })));
    setPhotoFiles(files, `NAS · ${dataset.title}`);
    if (dataset.metadata) {
      const metadataResponse = await fetch(dataset.metadata.url, { cache:"no-store" });
      if (!metadataResponse.ok) throw new Error(`Could not read metadata (${metadataResponse.status})`);
      state.metadata = parseCsv(await metadataResponse.text());
      state.metadataTipColumn = state.metadata.headers.find(header => state.metadata.rows.some(row => state.tips.includes(row[header]))) || state.metadata.headers[0] || "";
    }
    ui["nas-dataset"].value = dataset.id; ui["share-dataset"].disabled = false; setDatasetQuery(dataset.id); renderMetadata();
  } catch (error) {
    state.nasDatasetId = ""; ui["share-dataset"].disabled = true; ui["tree-empty"].hidden = false; ui["tree-empty"].textContent = `Could not load NAS dataset: ${error.message || error}`;
  } finally { ui["load-nas-dataset"].disabled = !ui["nas-dataset"].value; }
}

async function copyDatasetLink() {
  if (!state.nasDatasetId) return;
  const url = new URL(window.location.href); url.searchParams.set("dataset", state.nasDatasetId);
  try { await navigator.clipboard.writeText(url.href); }
  catch {
    const input = document.createElement("textarea"); input.value = url.href; input.style.position = "fixed"; input.style.opacity = "0"; document.body.append(input); input.select(); document.execCommand("copy"); input.remove();
  }
  const button = ui["share-dataset"], original = button.textContent; button.textContent = "✓"; window.setTimeout(() => { button.textContent = original; },1000);
}


function setUploadStatus(message, warning = false) {
  ui["upload-status"].textContent = message; ui["upload-status"].classList.toggle("warning", warning); ui["upload-status"].hidden = !message;
}

function encodedPath(path) { return path.split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/"); }

async function uploadRaw(datasetId, kind, relative, file) {
  const response = await fetch(`/api/admin/datasets/${encodeURIComponent(datasetId)}/files/${kind}/${encodedPath(relative)}`, { method:"PUT", body:file });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || `Upload failed (${response.status})`); }
}

async function uploadDataset() {
  const datasetId = ui["upload-dataset-id"].value.trim(), title = ui["upload-dataset-title"].value.trim(), tree = ui["upload-tree-file"].files[0], metadata = ui["upload-metadata-file"].files[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(datasetId)) return setUploadStatus("Dataset ID may contain only letters, numbers, dots, underscores, and hyphens.", true);
  if (!tree) return setUploadStatus("Choose a tree file.", true);
  const photoFiles = [...ui["upload-photo-folder"].files].filter(file => /\.(?:jpe?g|png|gif|webp|tiff?|bmp|avif|heic|heif)$/i.test(file.name));
  const rootName = photoFiles[0]?.webkitRelativePath?.split("/")[0] || "";
  const uploads = [{ kind:"tree",relative:tree.name,file:tree }];
  if (metadata) uploads.push({ kind:"metadata",relative:metadata.name,file:metadata });
  for (const file of photoFiles) {
    const relative = file.webkitRelativePath.split("/").slice(rootName ? 1 : 0).join("/");
    if (relative.includes("/")) uploads.push({ kind:"photos",relative,file });
  }
  ui["upload-dataset"].disabled = true; ui["upload-progress"].hidden = false; ui["upload-progress"].max = uploads.length; ui["upload-progress"].value = 0; setUploadStatus(`Preparing ${uploads.length} file(s)…`);
  try {
    const createResponse = await fetch(`/api/admin/datasets/${encodeURIComponent(datasetId)}`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ title:title || datasetId, tree:tree.name, metadata:metadata?.name || "" }) });
    if (!createResponse.ok) { const payload = await createResponse.json().catch(() => ({})); throw new Error(payload.error || `Could not create dataset (${createResponse.status})`); }
    let next = 0, completed = 0;
    async function worker() {
      while (next < uploads.length) {
        const item = uploads[next++]; await uploadRaw(datasetId,item.kind,item.relative,item.file); completed += 1; ui["upload-progress"].value = completed; setUploadStatus(`Uploaded ${completed} of ${uploads.length} file(s)…`);
      }
    }
    await Promise.all(Array.from({ length:Math.min(3,uploads.length) },worker));
    setUploadStatus(`Upload complete: ${datasetId}`); await initNasDatasets(false); ui["nas-dataset"].value = datasetId; await loadNasDataset(datasetId);
  } catch (error) { setUploadStatus(`Upload stopped: ${error.message || error}`, true); }
  finally { ui["upload-dataset"].disabled = false; }
}
async function initNasDatasets(autoLoad = true) {
  try {
    const response = await fetch("/api/datasets", { cache:"no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    ui["nas-upload-panel"].hidden = false;
    for (const id of ["nas-dataset","load-nas-dataset","share-dataset"]) ui[id].hidden = false;
    ui["nas-dataset"].replaceChildren(new Option(payload.datasets?.length ? "NAS dataset" : "No NAS datasets", ""), ...(payload.datasets || []).map(dataset => new Option(dataset.title, dataset.id)));
    const requested = new URL(window.location.href).searchParams.get("dataset");
    if (autoLoad && requested && (payload.datasets || []).some(dataset => dataset.id === requested)) { ui["nas-dataset"].value = requested; await loadNasDataset(requested); }
  } catch { /* Static/local-only hosting keeps the original controls unchanged. */ }
}
function clearTree() {
  postViewer({ type:"phylophoto:clear" }); revokeImages(); Object.assign(state,{ loadId:0,loadedId:0,currentSettings:{},sourceTree:"",filename:"",parsedTree:null,tips:[],selectedTips:[],files:[],photoFolderHandle:null,nasDatasetId:"",folderIndex:new Map(),folderMatches:new Map(),metadata:null,metadataTipColumn:"",appliedRoot:null,pendingRootReport:null });
  ui["tree-empty"].replaceChildren(); const label = document.createElement("label"); label.className = "button primary"; label.htmlFor = "tree-file"; label.textContent = "Open a tree"; ui["tree-empty"].append(label); ui["tree-empty"].hidden = false;
  ui["photo-results"].replaceChildren(); ui["metadata-results"].replaceChildren(); ui["selection-summary"].textContent = ""; ui["tree-name"].textContent = ""; ui["photo-folder-name"].textContent = ""; ui["folder-warning-panel"].hidden = true; showStatus("");
  for (const id of ["tree-file","photo-folder","metadata-file","tip-search","outgroup-search","multiple-outgroups"]) ui[id].value = "";
  ui["tip-matches"].replaceChildren(); renderOutgroupPicker();
  ui["share-dataset"].disabled = true; setDatasetQuery();
  for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","select-tip","refresh-photo-folder"]) ui[id].disabled = true;
}
function updateMatchingControls() { const rule = ui["match-rule"].value; ui["delimiter-wrap"].hidden = rule !== "prefix"; ui["prefix-count-wrap"].hidden = rule !== "prefix"; ui["regex-wrap"].hidden = rule !== "regex"; }
function updateRootingControls() {
  const mode = ui["rooting-mode"].value;
  ui["outgroup-picker"].hidden = mode !== "single" && mode !== "multiple";
  if (mode === "single" && selectedOutgroups().length > 1) setOutgroups(selectedOutgroups().slice(0, 1));
  renderOutgroupPicker();
}
function startSplit(event) {
  event.preventDefault(); ui.splitter.classList.add("dragging"); document.body.classList.add("dragging");
  const move = moveEvent => { const rect = ui.workspace.getBoundingClientRect(); setPanelPercent(Math.min(75,Math.max(25,(moveEvent.clientX - rect.left) / rect.width * 100))); };
  const stop = () => { ui.splitter.classList.remove("dragging"); document.body.classList.remove("dragging"); window.removeEventListener("pointermove",move); saveUiPreferences(); window.dispatchEvent(new Event("resize")); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",stop,{ once:true });
}

ui["tree-file"].addEventListener("change",event => loadTree(event.target.files[0]));
ui["nas-dataset"].addEventListener("change",() => { ui["load-nas-dataset"].disabled = !ui["nas-dataset"].value; });
ui["load-nas-dataset"].addEventListener("click",() => loadNasDataset(ui["nas-dataset"].value));
ui["share-dataset"].addEventListener("click",copyDatasetLink);
ui["choose-photo-folder"].addEventListener("click",choosePhotoFolder);
ui["refresh-photo-folder"].addEventListener("click",refreshPhotoFolder);
ui["photo-folder"].addEventListener("change",event => { leaveNasDataset(); state.photoFolderHandle = null; setPhotoFiles([...event.target.files], event.target.files[0]?.webkitRelativePath?.split("/")[0] || ""); });
ui["metadata-file"].addEventListener("change",async event => { const file = event.target.files[0]; if (!file) return; state.metadata = parseCsv(await file.text()); state.metadataTipColumn = state.metadata.headers.find(header => state.metadata.rows.some(row => state.tips.includes(row[header]))) || state.metadata.headers[0] || ""; renderMetadata(); });
ui["clear-tree"].addEventListener("click",clearTree);
ui["select-tip"].addEventListener("click",() => { const name = ui["tip-search"].value.trim(); if (!state.tips.includes(name)) return showStatus(`Tip not found: ${name}`,true); requestPearTreeSelection([name]); showStatus(""); });
ui["tip-search"].addEventListener("input",renderTipMatches);
document.querySelectorAll('input[name="branch-mode"]').forEach(input => input.addEventListener("change",mountTree));
ui["save-visual-options"].addEventListener("click",() => {
  state.settingsRequest += 1; postViewer({ type:"phylophoto:get-settings",requestId:state.settingsRequest });
});
ui["reset-tree-view"].addEventListener("click",() => {
  localStorage.removeItem("uce-photo-peartree-settings"); localStorage.removeItem("phylophoto-client-saved-visual-settings");
  state.currentSettings = {};
  if (state.sourceTree) mountTree();
});
for (const id of ["match-rule","delimiter","prefix-count","match-regex","comparison-mode","case-sensitive"]) ui[id].addEventListener("change",() => { updateMatchingControls(); updateFolderMatches(); });
ui["rooting-mode"].addEventListener("change",updateRootingControls);
ui["outgroup-search"].addEventListener("input", renderOutgroupPicker);
ui["apply-root"].addEventListener("click",() => applyRoot()); ui.splitter.addEventListener("pointerdown",startSplit);
ui["upload-dataset"].addEventListener("click",uploadDataset);
ui.splitter.addEventListener("keydown",event => { if (!["ArrowLeft","ArrowRight"].includes(event.key)) return; event.preventDefault(); setPanelPercent(Math.min(75,Math.max(25,panelPercent() + (event.key === "ArrowRight" ? 2 : -2)))); saveUiPreferences(); });
window.addEventListener("message",event => {
  if (event.origin !== window.location.origin || event.source !== ui["tree-viewer"].contentWindow) return;
  const message = event.data || {};
  if (message.type === "phylophoto:ready") {
    state.viewerReady = true;
    if (state.sourceTree) mountTree();
  } else if (message.type === "phylophoto:tree-loaded" && message.loadId === state.loadId && state.loadedId !== message.loadId) {
    state.loadedId = message.loadId;
    ui["tree-empty"].hidden = true;
    if (state.appliedRoot) postViewer({ type:"phylophoto:root",request:state.appliedRoot });
  } else if (message.type === "phylophoto:selection") {
    setSelection(message.tips);
  } else if (message.type === "phylophoto:settings-changed") {
    state.currentSettings = message.settings || {};
  } else if (message.type === "phylophoto:settings" && message.requestId === state.settingsRequest) {
    state.currentSettings = message.settings || {};
    localStorage.setItem("phylophoto-client-saved-visual-settings",JSON.stringify(state.currentSettings));
    const button = ui["save-visual-options"], original = button.textContent;
    button.textContent = "Saved";
    window.setTimeout(() => { button.textContent = original; },1000);
  } else if (message.type === "phylophoto:root-applied") {
    if (state.pendingRootReport) showStatus(state.pendingRootReport.message,state.pendingRootReport.warning);
    state.pendingRootReport = null;
  } else if (message.type === "phylophoto:root-error" || message.type === "phylophoto:error") {
    showStatus(message.message || "PearTree error",true);
  }
});
ui["tree-viewer"].addEventListener("load",() => postViewer({ type:"phylophoto:ping" }));
window.addEventListener("beforeunload",revokeImages); restoreUiPreferences(); updateRootingControls(); postViewer({ type:"phylophoto:ping" }); initNasDatasets();
