"use strict";

import { buildFolderIndex, collectTips, extractNewick, matchFolders, mrcaDescendants, parseCsv, parseNewick, transformBranchLengths } from "./core.js";

const byId = id => document.getElementById(id);
const ids = ["tree-file","photo-folder","choose-photo-folder","refresh-photo-folder","nas-dataset","load-nas-dataset","share-dataset","nas-upload-panel","upload-target","upload-dataset-id","upload-tree-file","upload-photo-folder","upload-metadata-file","upload-dataset","upload-progress","upload-status","metadata-file","clear-tree","workspace","tree-name","tree-viewer","tree-empty","tree-panel","photo-panel","selection-summary","metadata-results","photo-results","splitter","tip-search","tip-matches","tip-prev","tip-next","tip-match-position","select-tip","save-visual-options","reset-tree-view","photo-folder-name","match-rule","delimiter-wrap","delimiter","prefix-count","prefix-count-wrap","regex-wrap","match-regex","comparison-mode","case-sensitive","lazy-photo-loading","rooting-mode","outgroup-picker","outgroup-search","outgroup-matches","outgroup-selected","multiple-outgroups","apply-root","rooting-status","folder-warning-panel","folder-warning-summary","folder-warning-rows","settings-button","settings-drawer","drawer-backdrop","settings-content","close-settings","language-select","editing-panel","editing-disabled-note","rename-search","rename-search-mode","rename-replacement","rename-auto-fill","rename-add-selected","rename-results","rename-operations","rename-preview","rename-commit","create-tip-folders","rollback-last-edit","rename-preview-output","editing-status","photo-viewer","photo-viewer-close","photo-viewer-prev","photo-viewer-next","photo-viewer-zoom-out","photo-viewer-zoom-in","photo-viewer-reset","photo-viewer-zoom","photo-viewer-caption","photo-viewer-stage","photo-viewer-image"];
const ui = Object.fromEntries(ids.map(id => [id, byId(id)]));
const state = { viewerReady: false, loadId: 0, loadedId: 0, settingsRequest: 0, currentSettings: {}, sourceTree: "", filename: "", parsedTree: null, tips: [], selectedTips: [], files: [], photoFolderHandle: null, nasDatasetId: "", folderIndex: new Map(), folderMatches: new Map(), imageUrls: [], photoObserver: null, metadata: null, metadataTipColumn: "", appliedRoot: null, pendingRootReport: null, tipMatches: [], tipMatchIndex: 0, editingEnabled: false, renameRows: new Map(), renameOperations: new Map(), lastBackupId: "", viewerPhotos: [], viewerIndex: 0, viewerZoom: 1, viewerPan: { x: 0, y: 0 } };

const translations = { en: { openTree:"Open tree", settings:"Settings", language:"Language", editNas:"Edit NAS dataset" }, "zh-Hant": { openTree:"開啟 tree", settings:"設定", language:"語言", editNas:"編輯 NAS dataset" } };
function openSettings() {
  if (!ui["settings-drawer"] || !ui["close-settings"]) return;
  ui["settings-drawer"].hidden = false;
  ui["settings-drawer"].classList.add("open");
  ui["settings-drawer"].setAttribute("aria-hidden", "false");
  ui["close-settings"].focus();
}
function closeSettings() {
  if (!ui["settings-drawer"]) return;
  ui["settings-drawer"].classList.remove("open");
  ui["settings-drawer"].setAttribute("aria-hidden", "true");
  ui["settings-drawer"].hidden = true;
  ui["settings-button"]?.focus();
}
ui["settings-button"]?.addEventListener("click", openSettings);
ui["close-settings"]?.addEventListener("click", closeSettings);
ui["drawer-backdrop"]?.addEventListener("click", closeSettings);
function applyLanguage(language = ui["language-select"].value) {
  const selected = translations[language] ? language : "en";
  ui["language-select"].value = selected; document.documentElement.lang = selected === "zh-Hant" ? "zh-Hant" : "en";
  document.querySelectorAll("[data-i18n]").forEach(node => { const key = node.dataset.i18n; if (translations[selected][key]) node.textContent = translations[selected][key]; });
  localStorage.setItem("phylophoto-language", selected);
}

function matchingOptions() {
  return { rule: ui["match-rule"].value, delimiter: ui.delimiter.value, fieldCount: Number(ui["prefix-count"].value), pattern: ui["match-regex"].value, comparison: ui["comparison-mode"].value, caseSensitive: ui["case-sensitive"].checked };
}
function verticalLayout() { return matchMedia("(max-width: 820px)").matches; }
function panelPercent() { const box = ui.workspace.getBoundingClientRect(), panel = ui["tree-panel"].getBoundingClientRect(); const total = verticalLayout() ? box.height : box.width; const size = verticalLayout() ? panel.height : panel.width; return total ? size / total * 100 : 56; }
function setPanelPercent(percent) {
  if (verticalLayout()) ui.workspace.style.gridTemplateRows = `minmax(260px,${percent}fr) 10px minmax(260px,${100 - percent}fr)`;
  else ui.workspace.style.gridTemplateColumns = `minmax(300px,${percent}fr) 10px minmax(300px,${100 - percent}fr)`;
  ui.splitter.setAttribute("aria-valuenow", Math.round(percent));
}
function saveUiPreferences() { localStorage.setItem("phylophoto-client-ui", JSON.stringify({ panel: panelPercent(), matching: matchingOptions(), lazyPhotoLoading: ui["lazy-photo-loading"].checked })); }
function restoreUiPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem("phylophoto-client-ui") || "{}"), matching = saved.matching || {};
    if (saved.panel >= 25 && saved.panel <= 75) setPanelPercent(saved.panel);
    if (["full","prefix","regex"].includes(matching.rule)) ui["match-rule"].value = matching.rule;
    if (typeof matching.delimiter === "string") ui.delimiter.value = matching.delimiter;
    if (Number(matching.fieldCount) >= 1) ui["prefix-count"].value = matching.fieldCount;
    if (typeof matching.pattern === "string") ui["match-regex"].value = matching.pattern;
    if (["equals","starts"].includes(matching.comparison)) ui["comparison-mode"].value = matching.comparison;
    ui["case-sensitive"].checked = Boolean(matching.caseSensitive); ui["lazy-photo-loading"].checked = Boolean(saved.lazyPhotoLoading);
  } catch { localStorage.removeItem("phylophoto-client-ui"); }
  updateMatchingControls();
}
function showStatus(message, warning = false) { ui["rooting-status"].textContent = message; ui["rooting-status"].classList.toggle("warning", warning); ui["rooting-status"].hidden = !message; }
function revokeImages() { state.photoObserver?.disconnect(); state.photoObserver = null; state.imageUrls.forEach(URL.revokeObjectURL); state.imageUrls = []; }

function updatePhotoViewer() {
  const item = state.viewerPhotos[state.viewerIndex];
  if (!item) return closePhotoViewer();
  ui["photo-viewer-image"].src = item.url; ui["photo-viewer-image"].alt = item.name; ui["photo-viewer-caption"].textContent = item.caption;
  ui["photo-viewer-prev"].disabled = state.viewerPhotos.length < 2; ui["photo-viewer-next"].disabled = state.viewerPhotos.length < 2;
  ui["photo-viewer-zoom"].textContent = `${Math.round(state.viewerZoom * 100)}%`;
  ui["photo-viewer-image"].style.transform = `translate(calc(-50% + ${state.viewerPan.x}px), calc(-50% + ${state.viewerPan.y}px)) scale(${state.viewerZoom})`;
}
function openPhotoViewer(index) { if (!state.viewerPhotos.length) return; state.viewerIndex = Math.max(0, Math.min(index, state.viewerPhotos.length - 1)); state.viewerZoom = 1; state.viewerPan = { x: 0, y: 0 }; ui["photo-viewer"].hidden = false; updatePhotoViewer(); ui["photo-viewer-close"].focus(); }
function closePhotoViewer() { ui["photo-viewer"].hidden = true; ui["photo-viewer-image"].removeAttribute("src"); }
function changePhotoViewerIndex(delta) { if (!state.viewerPhotos.length) return; state.viewerIndex = (state.viewerIndex + delta + state.viewerPhotos.length) % state.viewerPhotos.length; state.viewerZoom = 1; state.viewerPan = { x: 0, y: 0 }; updatePhotoViewer(); }
function setPhotoViewerZoom(value) { state.viewerZoom = Math.max(.25, Math.min(6, value)); updatePhotoViewer(); }

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
  revokeImages(); ui["photo-results"].replaceChildren(); state.viewerPhotos = [];
  const progressive = ui["lazy-photo-loading"].checked && "IntersectionObserver" in window;
  if (progressive) {
    state.photoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const image = entry.target;
        image.src = image.dataset.source;
        delete image.dataset.source;
        state.photoObserver?.unobserve(image);
      });
    }, { root: ui["photo-panel"], rootMargin:"240px 0px" });
  }
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
      const viewerItem = { url, name: file.name, caption: file.webkitRelativePath || file.name }; state.viewerPhotos.push(viewerItem);
      image.tabIndex = 0; image.role = "button"; image.addEventListener("click", () => openPhotoViewer(state.viewerPhotos.indexOf(viewerItem))); image.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPhotoViewer(state.viewerPhotos.indexOf(viewerItem)); } });
      if (!file.url) state.imageUrls.push(url); if (progressive) { image.dataset.source = url; state.photoObserver.observe(image); } else image.src = url; image.alt = file.name; caption.textContent = file.webkitRelativePath || file.name; figure.append(image,caption); stack.append(figure);
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
  state.tipMatches = search ? state.tips.filter(name => name.toLocaleLowerCase().includes(search)) : [];
  state.tipMatchIndex = Math.min(state.tipMatchIndex, Math.max(0, state.tipMatches.length - 1));
  const matches = state.tipMatches.slice(0, 12);
  ui["tip-matches"].replaceChildren(...matches.map(name => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "outgroup-match"; button.textContent = name; button.setAttribute("role", "option");
    button.addEventListener("click", () => { ui["tip-search"].value = name; ui["tip-matches"].replaceChildren(); requestPearTreeSelection([name]); showStatus(""); });
    return button;
  }));
  ui["tip-prev"].disabled = !state.tipMatches.length; ui["tip-next"].disabled = !state.tipMatches.length;
  ui["tip-match-position"].textContent = state.tipMatches.length ? `${state.tipMatchIndex + 1}/${state.tipMatches.length}` : "";
}
function selectTipMatch(index) {
  if (!state.tipMatches.length) return;
  state.tipMatchIndex = (index + state.tipMatches.length) % state.tipMatches.length;
  const name = state.tipMatches[state.tipMatchIndex]; ui["tip-search"].value = name; renderTipMatches(); requestPearTreeSelection([name]); showStatus("");
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
  for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","tip-prev","tip-next","select-tip"]) ui[id].disabled = false;
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

function updateUploadTarget() {
  const existing = ui["upload-target"].value;
  ui["upload-dataset-id"].disabled = Boolean(existing);
  ui["upload-tree-file"].disabled = Boolean(existing);
  ui["upload-metadata-file"].disabled = Boolean(existing);
  if (existing) { ui["upload-dataset-id"].value = existing; ui["upload-tree-file"].value = ""; ui["upload-metadata-file"].value = ""; }
}

async function uploadDataset() {
  const existing = ui["upload-target"].value, datasetId = existing || ui["upload-dataset-id"].value.trim(), tree = ui["upload-tree-file"].files[0], metadata = ui["upload-metadata-file"].files[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(datasetId)) return setUploadStatus("Folder name may contain only letters, numbers, dots, underscores, and hyphens.", true);
  if (!existing && !tree) return setUploadStatus("Choose a tree file for a new folder.", true);
  const photoFiles = [...ui["upload-photo-folder"].files].filter(file => /\.(?:jpe?g|png|gif|webp|tiff?|bmp|avif|heic|heif)$/i.test(file.name));
  if (existing && !photoFiles.length) return setUploadStatus("Choose photos to add to the selected NAS folder.", true);
  const rootName = photoFiles[0]?.webkitRelativePath?.split("/")[0] || "";
  const uploads = [];
  if (tree) uploads.push({ kind:"tree",relative:tree.name,file:tree });
  if (metadata) uploads.push({ kind:"metadata",relative:metadata.name,file:metadata });
  for (const file of photoFiles) {
    const relative = file.webkitRelativePath.split("/").slice(rootName ? 1 : 0).join("/");
    if (relative.includes("/")) uploads.push({ kind:"photos",relative,file });
  }
  ui["upload-dataset"].disabled = true; ui["upload-progress"].hidden = false; ui["upload-progress"].max = uploads.length; ui["upload-progress"].value = 0; setUploadStatus(`Preparing ${uploads.length} file(s)…`);
  try {
    const createResponse = await fetch(`/api/admin/datasets/${encodeURIComponent(datasetId)}`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ append:Boolean(existing), tree:tree?.name || "", metadata:metadata?.name || "" }) });
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
    const selectedUploadTarget = ui["upload-target"].value;
    ui["upload-target"].replaceChildren(new Option("New folder", ""), ...(payload.datasets || []).map(dataset => new Option(dataset.title, dataset.id)));
    if ((payload.datasets || []).some(dataset => dataset.id === selectedUploadTarget)) ui["upload-target"].value = selectedUploadTarget;
    updateUploadTarget();
    for (const id of ["nas-dataset","load-nas-dataset","share-dataset"]) ui[id].hidden = false;
    ui["nas-dataset"].replaceChildren(new Option(payload.datasets?.length ? "NAS dataset" : "No NAS datasets", ""), ...(payload.datasets || []).map(dataset => new Option(dataset.title, dataset.id)));
    const requested = new URL(window.location.href).searchParams.get("dataset");
    if (autoLoad && requested && (payload.datasets || []).some(dataset => dataset.id === requested)) { ui["nas-dataset"].value = requested; await loadNasDataset(requested); }
  } catch { /* Static/local-only hosting keeps the original controls unchanged. */ }
}

function setEditingStatus(message, warning = false) { ui["editing-status"].textContent = message; ui["editing-status"].classList.toggle("warning", warning); ui["editing-status"].hidden = !message; }
function renameCandidates() {
  const query = ui["rename-search"].value;
  if (!query) return [];
  try {
    if (ui["rename-search-mode"].value === "regex") return state.tips.filter(tip => new RegExp(query, "u").test(tip));
    return state.tips.filter(tip => ui["rename-search-mode"].value === "exact" ? tip === query : tip.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  } catch (error) { setEditingStatus(`Invalid search pattern: ${error.message}`, true); return []; }
}
function autoRenameValue(tip) {
  const query = ui["rename-search"].value, replacement = ui["rename-replacement"].value;
  if (!replacement) return tip;
  try { return ui["rename-search-mode"].value === "regex" ? tip.replace(new RegExp(query, "u"), replacement) : ui["rename-search-mode"].value === "exact" ? replacement : tip.split(query).join(replacement); } catch { return tip; }
}
function renderRenameResults() {
  ui["rename-results"].replaceChildren(); const candidates = renameCandidates(); if (!candidates.length) return;
  const table = document.createElement("table"), thead = document.createElement("thead"), head = document.createElement("tr"); ["Use","Current tip","New label"].forEach(text => { const th = document.createElement("th"); th.textContent = text; head.append(th); }); thead.append(head);
  const body = document.createElement("tbody"); candidates.forEach(tip => { const row = document.createElement("tr"), check = document.createElement("input"), input = document.createElement("input"); check.type = "checkbox"; check.checked = true; input.value = state.renameRows.get(tip)?.to || autoRenameValue(tip); input.dataset.tip = tip; row.dataset.tip = tip; const checkCell = document.createElement("td"), oldCell = document.createElement("td"), newCell = document.createElement("td"); checkCell.append(check); oldCell.textContent = tip; newCell.append(input); row.append(checkCell,oldCell,newCell); body.append(row); });
  table.append(thead,body); ui["rename-results"].append(table);
}
function renderRenameOperations() {
  ui["rename-operations"].replaceChildren(); if (!state.renameOperations.size) return;
  const table = document.createElement("table"), thead = document.createElement("thead"), head = document.createElement("tr"); ["Current label","New label",""] .forEach(text => { const th = document.createElement("th"); th.textContent = text; head.append(th); }); thead.append(head);
  const body = document.createElement("tbody"); state.renameOperations.forEach((to, from) => { const row = document.createElement("tr"), oldCell = document.createElement("td"), newCell = document.createElement("td"), action = document.createElement("td"), remove = document.createElement("button"); oldCell.textContent = from; newCell.textContent = to; remove.type = "button"; remove.textContent = "Remove"; remove.addEventListener("click", () => { state.renameOperations.delete(from); renderRenameOperations(); ui["rename-commit"].disabled = true; }); action.append(remove); row.append(oldCell,newCell,action); body.append(row); });
  table.append(thead,body); ui["rename-operations"].append(table);
}
function addSelectedRenames() {
  ui["rename-results"].querySelectorAll("tbody tr").forEach(row => { const check = row.querySelector("input[type=checkbox]"), input = row.querySelector("input[data-tip]"); if (check?.checked && input?.value && input.value !== row.dataset.tip) state.renameOperations.set(row.dataset.tip, input.value); });
  renderRenameOperations(); setEditingStatus(state.renameOperations.size ? `${state.renameOperations.size} rename operation(s) ready for preview.` : "No changed labels selected.");
}
async function previewRenames() {
  if (!state.nasDatasetId) return setEditingStatus("Load a NAS dataset before editing.", true); const operations = [...state.renameOperations].map(([from,to]) => ({from,to})); if (!operations.length) return setEditingStatus("Add at least one rename operation.", true);
  try { const response = await fetch(`/api/admin/datasets/${encodeURIComponent(state.nasDatasetId)}/rename/preview`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({operations}) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Preview failed (${response.status})`); ui["rename-preview-output"].textContent = `Tree: ${payload.treeFilename}\nChanges: ${payload.changes.length}\n\n--- Original ---\n${payload.original}\n--- Updated ---\n${payload.updated}\n\nFolder actions:\n${payload.folders.map(item => `${item.from} -> ${item.to}${item.exists ? " (sync)" : " (folder absent; tree only)"}`).join("\n")}`; ui["rename-preview-output"].hidden = false; ui["rename-commit"].disabled = !payload.changes.length; setEditingStatus("Review the complete preview before writing."); } catch (error) { ui["rename-commit"].disabled = true; setEditingStatus(error.message || String(error), true); }
}
async function commitRenames() {
  if (!state.nasDatasetId || !state.renameOperations.size || !window.confirm("Write these leaf-label changes to the NAS tree and sync matching tip folders?")) return;
  try { const operations = [...state.renameOperations].map(([from,to]) => ({from,to})); const response = await fetch(`/api/admin/datasets/${encodeURIComponent(state.nasDatasetId)}/rename/commit`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({operations}) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Write failed (${response.status})`); state.lastBackupId = payload.backupId; ui["rollback-last-edit"].hidden = false; setEditingStatus(`Wrote ${payload.changes.length} leaf label(s). Backup: ${payload.backupId}`); state.renameOperations.clear(); renderRenameOperations(); ui["rename-commit"].disabled = true; await loadNasDataset(state.nasDatasetId); } catch (error) { setEditingStatus(error.message || String(error), true); }
}
async function createTipFolders() {
  if (!state.nasDatasetId || !window.confirm("Create missing folders for every tip in this NAS tree?")) return;
  try { const response = await fetch(`/api/admin/datasets/${encodeURIComponent(state.nasDatasetId)}/tip-folders`, { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Folder creation failed (${response.status})`); setEditingStatus(payload.created.length ? `Created ${payload.created.length} tip folder(s).` : "All tip folders already exist."); await loadNasDataset(state.nasDatasetId); } catch (error) { setEditingStatus(error.message || String(error), true); }
}
async function rollbackLastEdit() {
  if (!state.nasDatasetId || !state.lastBackupId || !window.confirm("Restore the last backup and undo the most recent edit?")) return;
  try { const response = await fetch(`/api/admin/datasets/${encodeURIComponent(state.nasDatasetId)}/rollback`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({backupId:state.lastBackupId}) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Rollback failed (${response.status})`); setEditingStatus(`Rolled back backup ${payload.backupId}.`); await loadNasDataset(state.nasDatasetId); } catch (error) { setEditingStatus(error.message || String(error), true); }
}
async function initCapabilities() {
  try { const payload = await fetchJson("/api/capabilities"); state.editingEnabled = Boolean(payload.editing); ui["editing-panel"].hidden = !state.editingEnabled; if (!state.editingEnabled) { ui["editing-disabled-note"].hidden = false; ui["editing-disabled-note"].textContent = "NAS editing is disabled. Set PHYLOPHOTO_ENABLE_EDITING=1 and restart the container to enable it."; } } catch { ui["editing-panel"].hidden = true; }
}
function clearTree() {
  postViewer({ type:"phylophoto:clear" }); revokeImages(); Object.assign(state,{ loadId:0,loadedId:0,currentSettings:{},sourceTree:"",filename:"",parsedTree:null,tips:[],selectedTips:[],files:[],photoFolderHandle:null,nasDatasetId:"",folderIndex:new Map(),folderMatches:new Map(),metadata:null,metadataTipColumn:"",appliedRoot:null,pendingRootReport:null });
  ui["tree-empty"].replaceChildren(); const label = document.createElement("label"); label.className = "button primary"; label.htmlFor = "tree-file"; label.textContent = "Open a tree"; ui["tree-empty"].append(label); ui["tree-empty"].hidden = false;
  ui["photo-results"].replaceChildren(); ui["metadata-results"].replaceChildren(); ui["selection-summary"].textContent = ""; ui["tree-name"].textContent = ""; ui["photo-folder-name"].textContent = ""; ui["folder-warning-panel"].hidden = true; showStatus("");
  for (const id of ["tree-file","photo-folder","metadata-file","tip-search","outgroup-search","multiple-outgroups"]) ui[id].value = "";
  ui["tip-matches"].replaceChildren(); renderOutgroupPicker();
  ui["share-dataset"].disabled = true; setDatasetQuery();
  for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","tip-prev","tip-next","select-tip","refresh-photo-folder"]) ui[id].disabled = true;
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
  const move = moveEvent => { const rect = ui.workspace.getBoundingClientRect(); const value = verticalLayout() ? (moveEvent.clientY - rect.top) / rect.height * 100 : (moveEvent.clientX - rect.left) / rect.width * 100; setPanelPercent(Math.min(75,Math.max(25,value))); };
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
ui["tip-prev"].addEventListener("click",() => selectTipMatch(state.tipMatchIndex - 1)); ui["tip-next"].addEventListener("click",() => selectTipMatch(state.tipMatchIndex + 1));
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
ui["upload-target"].addEventListener("change",updateUploadTarget);
ui["lazy-photo-loading"].addEventListener("change",() => { saveUiPreferences(); renderPhotos(); });
ui.splitter.addEventListener("keydown",event => { const vertical = verticalLayout(), allowed = vertical ? ["ArrowUp","ArrowDown"] : ["ArrowLeft","ArrowRight"]; if (!allowed.includes(event.key)) return; event.preventDefault(); const increase = vertical ? event.key === "ArrowDown" : event.key === "ArrowRight"; setPanelPercent(Math.min(75,Math.max(25,panelPercent() + (increase ? 2 : -2)))); saveUiPreferences(); });
ui["language-select"].addEventListener("change",event => applyLanguage(event.target.value));
ui["rename-search"].addEventListener("input",renderRenameResults); ui["rename-search-mode"].addEventListener("change",renderRenameResults); ui["rename-replacement"].addEventListener("input",renderRenameResults);
ui["rename-auto-fill"].addEventListener("click",renderRenameResults); ui["rename-add-selected"].addEventListener("click",addSelectedRenames); ui["rename-preview"].addEventListener("click",previewRenames); ui["rename-commit"].addEventListener("click",commitRenames); ui["create-tip-folders"].addEventListener("click",createTipFolders); ui["rollback-last-edit"].addEventListener("click",rollbackLastEdit);
ui["photo-viewer-close"].addEventListener("click",closePhotoViewer); ui["photo-viewer-prev"].addEventListener("click",() => changePhotoViewerIndex(-1)); ui["photo-viewer-next"].addEventListener("click",() => changePhotoViewerIndex(1)); ui["photo-viewer-zoom-out"].addEventListener("click",() => setPhotoViewerZoom(state.viewerZoom - .25)); ui["photo-viewer-zoom-in"].addEventListener("click",() => setPhotoViewerZoom(state.viewerZoom + .25)); ui["photo-viewer-reset"].addEventListener("click",() => { state.viewerZoom = 1; state.viewerPan = {x:0,y:0}; updatePhotoViewer(); }); ui["photo-viewer"].querySelector(".viewer-backdrop").addEventListener("click",closePhotoViewer);
ui["photo-viewer-stage"].addEventListener("wheel",event => { event.preventDefault(); setPhotoViewerZoom(state.viewerZoom + (event.deltaY < 0 ? .1 : -.1)); }, { passive:false });
let photoDrag = null; ui["photo-viewer-stage"].addEventListener("pointerdown",event => { if (event.target !== ui["photo-viewer-image"]) return; photoDrag = {x:event.clientX,y:event.clientY,pan:{...state.viewerPan}}; ui["photo-viewer-stage"].classList.add("dragging"); ui["photo-viewer-stage"].setPointerCapture(event.pointerId); }); ui["photo-viewer-stage"].addEventListener("pointermove",event => { if (!photoDrag) return; state.viewerPan = {x:photoDrag.pan.x + event.clientX - photoDrag.x, y:photoDrag.pan.y + event.clientY - photoDrag.y}; updatePhotoViewer(); }); ui["photo-viewer-stage"].addEventListener("pointerup",() => { photoDrag = null; ui["photo-viewer-stage"].classList.remove("dragging"); });
window.addEventListener("keydown",event => { if (event.key === "Escape") { if (!ui["photo-viewer"].hidden) closePhotoViewer(); else if (ui["settings-drawer"].classList.contains("open")) closeSettings(); } else if (!ui["photo-viewer"].hidden && event.key === "ArrowLeft") changePhotoViewerIndex(-1); else if (!ui["photo-viewer"].hidden && event.key === "ArrowRight") changePhotoViewerIndex(1); });
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
window.addEventListener("beforeunload",revokeImages); applyLanguage(localStorage.getItem("phylophoto-language") || "en"); restoreUiPreferences(); updateRootingControls(); postViewer({ type:"phylophoto:ping" }); initCapabilities(); initNasDatasets();
