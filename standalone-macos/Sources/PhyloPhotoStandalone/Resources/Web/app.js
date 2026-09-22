"use strict";

import { buildFolderIndex, collectTips, extractNewick, matchFolders, mrcaDescendants, parseNewick, transformBranchLengths } from "./core.js";
import { listTreeLabels, parseRenameRules, renameTreeLabels } from "./tree-text.js";

const byId = id => document.getElementById(id);
const ids = ["tree-file","open-tree-empty","open-tree-default","open-tree-text","open-tree-export","tree-tip-search","tree-tip-previous","tree-tip-next","tree-tip-match-status","photo-folder","open-photo-empty","recent-photo-folders","recent-photo-folder-list","refresh-photo-folder","open-rename","close-rename","cancel-rename","rename-drawer","rename-drawer-resizer","open-settings","close-settings","settings-drawer","settings-scrim","drawer-resizer","clear-tree","workspace","tree-name","tree-viewer","tree-empty","tree-panel","photo-panel","photo-empty","selection-summary","photo-results","splitter","tip-search","tip-matches","select-tip","rename-mode","rename-search","rename-suggestions","rename-replacement","rename-replacement-suggestions","rename-photo-folders","rename-batch","rename-batch-panel","rename-source","rename-source-label","rename-match-status","rename-matches","rename-match-rows","preview-rename","apply-rename","rename-status","rename-review","rename-actions","rename-preview","rename-preview-rows","save-visual-options","reset-tree-view","photo-folder-name","match-rule","delimiter-wrap","delimiter","prefix-count","prefix-count-wrap","regex-wrap","match-regex","comparison-mode","case-sensitive","lazy-photo-loading","create-tip-folders","rooting-mode","outgroup-picker","outgroup-search","outgroup-matches","outgroup-selected","multiple-outgroups","apply-root","rooting-status","folder-warning-panel","folder-warning-summary","folder-warning-rows","app-language"];
const ui = Object.fromEntries(ids.map(id => [id, byId(id)]));
const treeEmptyArtwork = byId("tree-empty-art");
const state = { viewerReady: false, loadId: 0, loadedId: 0, settingsRequest: 0, currentSettings: {}, sourceTree: "", rawTreeText: "", filename: "", treePath: "", parsedTree: null, tips: [], selectedTips: [], files: [], photoFolderHandle: null, photoFolderLoaded: false, folderIndex: new Map(), folderMatches: new Map(), recentPhotoFolders: [], imageUrls: [], photoObserver: null, appliedRoot: null, pendingRootReport: null, renameMatches: null, renameSelectedLabel: null, renamePreview: null, renameSaving: false, renameSuggestions: [], renameSuggestionIndex: -1, replacementSuggestions: [], replacementSuggestionIndex: -1, tipNavigationMatches: [], tipNavigationIndex: -1 };
const I18N = {
  en: { appTitle:"PhyloAtlas", open:"Open", text:"Text", export:"Export", openTree:"Open tree", photoFolder:"Photo folder", refresh:"Refresh photo folder", settings:"Settings", clear:"Clear", nodeSelection:"Node selection", treeSettings:"Tree settings", photoFolders:"Photo folders", rooting:"Rooting / outgroup", folderWarnings:"Folder warnings", language:"Language", systemLanguage:"System default", english:"English", chinese:"繁體中文", tip:"Tip", typeTip:"Type to match a tip", select:"Select", treeDisplay:"Tree display", original:"Original", proportional:"Proportional", equal:"Equal", saveVisual:"Save visual options", resetVisual:"Reset visual options", tipFolderKey:"Tip-to-folder key", fullTip:"Full tip label", leadingFields:"Leading fields", regularExpression:"Regular expression", delimiter:"Delimiter", comparison:"Comparison", equalsKey:"Equals key", startsKey:"Starts with key", caseSensitive:"Case-sensitive", loadOnScroll:"Load photos on scroll", createTipFolders:"Create tree tip folders…", destinationHint:"Choose a destination in Finder; one folder is created for each tree tip.", rootingMode:"Rooting mode", singleOutgroup:"Single outgroup", multipleOutgroups:"Multiple outgroups (MRCA)", midpoint:"Midpoint root", outgroupTips:"Outgroup tip(s)", applyRoot:"Apply root in PearTree", derivedKey:"Derived key", status:"Status", candidateFolders:"Candidate folders", close:"Close settings" },
  zh: { appTitle:"PhyloAtlas", open:"開啟預設程式", text:"開啟純文字", export:"匯出", openTree:"開啟 Tree", photoFolder:"開啟照片資料夾", refresh:"重新讀取照片資料夾", settings:"設定", clear:"清除", nodeSelection:"節點選取", treeSettings:"樹設定", photoFolders:"照片資料夾", rooting:"定根 / 外群", folderWarnings:"資料夾警告", language:"語言", systemLanguage:"系統預設", english:"English", chinese:"繁體中文", tip:"末端節點", typeTip:"輸入以尋找末端節點", select:"選取", treeDisplay:"樹顯示方式", original:"原始", proportional:"比例", equal:"等長", saveVisual:"儲存顯示設定", resetVisual:"重設顯示設定", tipFolderKey:"末端節點－資料夾鍵值", fullTip:"完整末端節點名稱", leadingFields:"前導欄位", regularExpression:"正規表示式", delimiter:"分隔符號", comparison:"比對方式", equalsKey:"完全符合鍵值", startsKey:"以鍵值開頭", caseSensitive:"區分大小寫", loadOnScroll:"捲動時載入照片", createTipFolders:"建立樹末端節點資料夾…", destinationHint:"會先在 Finder 選擇位置，再為每個樹末端節點建立資料夾。", rootingMode:"定根方式", singleOutgroup:"單一外群", multipleOutgroups:"多個外群（MRCA）", midpoint:"中點定根", outgroupTips:"外群末端節點", applyRoot:"在 PearTree 套用定根", derivedKey:"衍生鍵值", status:"狀態", candidateFolders:"候選資料夾", close:"關閉設定" }
};
Object.assign(I18N.en, { rename:"Rename", renameNodes:"Rename tip labels", renameStepFind:"1. Select a node label", renameStepReplace:"2. Set the new label", renameStepReview:"3. Review changes", originalLabel:"Original label", renameMode:"Search mode", literal:"Literal text", search:"Search", replace:"Replace with", renamePhotoFolders:"Rename matching photo folders", batchRename:"Batch rename", batchRules:"Batch rules", batchHint:"One rule per line: search => replacement", matchingNodeLabels:"Matching node labels", matchingNodeCount:"distinct node label(s) found.", noMatchingNodes:"No node labels match this search.", selectNodeBeforePreview:"Select one node label from the search results before previewing changes.", searchBeforePreview:"Search node labels before previewing replacements.", preview:"Preview changes", applyRename:"Confirm rename", before:"Before", after:"After", cancel:"Cancel", noRenameChanges:"No node labels would change.", renamePreviewCount:"node label(s) will change. Review the table, then confirm to save.", searchTips:"Search tips", previousTip:"Previous matching tip", nextTip:"Next matching tip", noMatchingTips:"No matches", photoTipCount:"photo tip(s)", loadPhylogenyTree:"Load Phylogeny Tree", recentPhotoFolders:"Recent photo folders", more:"More…", less:"Show less", noRecentPhotoFolders:"No recent photo folders" });
Object.assign(I18N.zh, { rename:"重新命名", renameNodes:"重新命名末端節點標籤", renameStepFind:"1. 選擇節點標籤", renameStepReplace:"2. 設定新名稱", renameStepReview:"3. 檢視更改", originalLabel:"原名稱", renameMode:"搜尋方式", literal:"一般文字", search:"搜尋", replace:"取代為", renamePhotoFolders:"同步更改對應照片資料夾", batchRename:"批次更名", batchRules:"批次規則", batchHint:"每行一條規則：搜尋 => 取代為", matchingNodeLabels:"搜尋到的節點標籤", matchingNodeCount:"個不同節點標籤符合搜尋。", noMatchingNodes:"沒有節點標籤符合此搜尋。", selectNodeBeforePreview:"請先從搜尋結果選擇一個節點標籤，再預覽更改。", searchBeforePreview:"請先搜尋節點標籤，再預覽取代結果。", preview:"預覽更改", applyRename:"確認更名", before:"更改前", after:"更改後", cancel:"取消", noRenameChanges:"沒有節點標籤需要更改。", renamePreviewCount:"個節點標籤將被更改。請檢視列表後確認儲存。", searchTips:"搜尋末端節點", previousTip:"上一個符合的末端節點", nextTip:"下一個符合的末端節點", noMatchingTips:"沒有符合項目", photoTipCount:"個有照片的末端節點", loadPhylogenyTree:"載入 Phylogeny Tree", recentPhotoFolders:"最近使用的照片資料夾", more:"更多…", less:"顯示較少", noRecentPhotoFolders:"尚無最近使用的照片資料夾" });
function languagePreference() { return localStorage.getItem("phylophoto-language") || "system"; }
function languageCode() { const pref = languagePreference(); return pref === "system" ? (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en") : pref; }
function t(key) { return I18N[languageCode()][key] || I18N.en[key] || key; }
function applyLanguage() { const language = languageCode(); document.documentElement.lang = language === "zh" ? "zh-Hant" : "en"; ui["app-language"].value = languagePreference(); document.querySelectorAll("[data-i18n]").forEach(element => { element.textContent = t(element.dataset.i18n); }); document.querySelectorAll("[data-i18n-title]").forEach(element => { element.title = t(element.dataset.i18nTitle); element.setAttribute("aria-label", t(element.dataset.i18nTitle)); }); document.querySelectorAll("[data-i18n-placeholder]").forEach(element => element.placeholder = t(element.dataset.i18nPlaceholder)); renderRecentPhotoFolders(); }

function nativePost(action, payload = {}) {
  const handler = window.webkit?.messageHandlers?.phylophotoNative;
  if (!handler) return false;
  handler.postMessage({ action, language: languageCode(), ...payload });
  return true;
}

function matchingOptions() {
  return { rule: ui["match-rule"].value, delimiter: ui.delimiter.value, fieldCount: Number(ui["prefix-count"].value), pattern: ui["match-regex"].value, comparison: ui["comparison-mode"].value, caseSensitive: ui["case-sensitive"].checked };
}
function panelPercent() { const width = ui.workspace.getBoundingClientRect().width; return width ? ui["tree-panel"].getBoundingClientRect().width / width * 100 : 56; }
function panelPercentLimits() { const width = ui.workspace.getBoundingClientRect().width, divider = ui.splitter.getBoundingClientRect().width || 1, usable = Math.max(1,width - divider); return { min:160 / usable * 100, max:100 - 220 / usable * 100 }; }
function setPanelPercent(percent) { const limits = panelPercentLimits(), value = Math.min(limits.max,Math.max(limits.min,Number(percent) || 56)); ui.workspace.style.gridTemplateColumns = `minmax(160px,${value}fr) 1px minmax(220px,${100 - value}fr)`; ui.splitter.setAttribute("aria-valuemin", Math.round(limits.min)); ui.splitter.setAttribute("aria-valuemax", Math.round(limits.max)); ui.splitter.setAttribute("aria-valuenow", Math.round(value)); }
function drawerWidthLimit() { return { min:Math.min(320,window.innerWidth), max:window.innerWidth }; }
function setDrawerWidth(width) { const limits = drawerWidthLimit(), value = Math.round(Math.min(limits.max,Math.max(limits.min,Number(width) || Math.round(window.innerWidth / 2)))); document.documentElement.style.setProperty("--settings-drawer-width", `${value}px`); ui["drawer-resizer"].setAttribute("aria-valuemin", limits.min); ui["drawer-resizer"].setAttribute("aria-valuemax", limits.max); ui["drawer-resizer"].setAttribute("aria-valuenow", value); }
function currentDrawerWidth() { return Math.round(ui["settings-drawer"].getBoundingClientRect().width); }
function saveUiPreferences() { localStorage.setItem("phylophoto-client-ui", JSON.stringify({ panel: panelPercent(), drawerWidth:currentDrawerWidth(), matchingDefaultsVersion:2, matching: matchingOptions(), lazyPhotoLoading: ui["lazy-photo-loading"].checked })); }
function restoreUiPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem("phylophoto-client-ui") || "{}"), matching = saved.matching || {};
    if (saved.panel > 0 && saved.panel < 100) setPanelPercent(saved.panel);
    if (Number(saved.drawerWidth) > 0) setDrawerWidth(saved.drawerWidth);
    const migrateLegacyDefault = saved.matchingDefaultsVersion !== 2 && matching.rule === "full" && matching.comparison === "equals";
    if (migrateLegacyDefault) { ui["match-rule"].value = "prefix"; ui["comparison-mode"].value = "starts"; }
    else if (["full","prefix","regex"].includes(matching.rule)) ui["match-rule"].value = matching.rule;
    if (typeof matching.delimiter === "string") ui.delimiter.value = matching.delimiter;
    if (Number(matching.fieldCount) >= 1) ui["prefix-count"].value = matching.fieldCount;
    if (typeof matching.pattern === "string") ui["match-regex"].value = matching.pattern;
    if (!migrateLegacyDefault && ["equals","starts"].includes(matching.comparison)) ui["comparison-mode"].value = matching.comparison;
    ui["case-sensitive"].checked = Boolean(matching.caseSensitive); ui["lazy-photo-loading"].checked = Boolean(saved.lazyPhotoLoading);
  } catch { localStorage.removeItem("phylophoto-client-ui"); }
  updateMatchingControls();
}
function showStatus(message, warning = false) { ui["rooting-status"].textContent = message; ui["rooting-status"].classList.toggle("warning", warning); ui["rooting-status"].hidden = !message; }
function revokeImages() { state.photoObserver?.disconnect(); state.photoObserver = null; state.imageUrls.forEach(URL.revokeObjectURL); state.imageUrls = []; }
function setScrim() { ui["settings-scrim"].classList.toggle("is-open", ui["settings-drawer"].classList.contains("is-open") || ui["rename-drawer"].classList.contains("is-open")); }
function setSettingsDrawer(open) { if (open && ui["rename-drawer"].classList.contains("is-open")) return; ui["settings-drawer"].classList.toggle("is-open", open); ui["settings-drawer"].setAttribute("aria-hidden", String(!open)); ui["open-settings"].setAttribute("aria-expanded", String(open)); ui["open-settings"].classList.toggle("is-active", open); setScrim(); }
function setRenameDrawer(open) { if (open) setSettingsDrawer(false); ui["rename-drawer"].classList.toggle("is-open", open); ui["rename-drawer"].setAttribute("aria-hidden", String(!open)); ui["open-rename"].classList.toggle("is-active", open); setScrim(); }

function setPhotoFiles(files, folderName = "", folderNames = []) {
  state.files = files;
  state.photoFolderLoaded = true; ui["photo-empty"].hidden = true;
  state.folderIndex = buildFolderIndex(files);
  for (const name of folderNames) if (typeof name === "string" && name && !state.folderIndex.has(name)) state.folderIndex.set(name, []);
  ui["photo-folder-name"].textContent = folderName;
  ui["refresh-photo-folder"].disabled = !state.photoFolderHandle;
  ui["create-tip-folders"].disabled = !state.tips.length;
  updateFolderMatches();
}

function renderRecentPhotoFolders() {
  const folders = state.recentPhotoFolders;
  ui["recent-photo-folder-list"].replaceChildren(...folders.map(folder => {
    const button = document.createElement("button"); button.type = "button"; button.className = "recent-photo-folder";
    const name = document.createElement("span"); name.className = "recent-photo-folder-name"; name.textContent = folder.name;
    const path = document.createElement("span"); path.className = "recent-photo-folder-path"; path.textContent = folder.path;
    button.title = folder.path; button.setAttribute("aria-label", `${folder.name}: ${folder.path}`);
    button.append(name, path); button.addEventListener("click", () => nativePost("openRecentPhotoFolder", { path: folder.path, hasTree: Boolean(state.sourceTree) }));
    return button;
  }));
  ui["recent-photo-folders"].hidden = !folders.length;
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
  if (nativePost("choosePhotoFolder", { hasTree: Boolean(state.sourceTree) })) return;
  if (!window.showDirectoryPicker) { ui["photo-folder"].click(); return; }
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    state.photoFolderHandle = handle;
    setPhotoFiles(await filesFromDirectory(handle), handle.name);
  } catch (error) {
    if (error?.name !== "AbortError") showStatus(`Could not read photo folder: ${error.message || error}`, true);
  }
}

async function refreshPhotoFolder() {
  if (nativePost("refreshPhotoFolder")) return;
  if (!state.photoFolderHandle) return;
  try {
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
    ui["folder-warning-summary"].textContent = `${t("folderWarnings")} (${warnings.length})`;
    ui["folder-warning-rows"].replaceChildren(...warnings.map(match => {
      const row = document.createElement("tr");
      [match.tip,match.key,match.status,match.candidates.join(", ")].forEach(value => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
      return row;
    }));
    renderPhotos(); if (!ui["tree-tip-search"].value.trim()) updateTipNavigator(); saveUiPreferences();
  } catch (error) { ui["folder-warning-panel"].hidden = false; ui["folder-warning-summary"].textContent = `Folder matching error — ${error.message || error}`; }
}

function renderPhotos() {
  revokeImages(); ui["photo-results"].replaceChildren();
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
  if (!state.selectedTips.length || !state.photoFolderLoaded) return;
  let count = 0;
  for (const tip of state.selectedTips) {
    const match = state.folderMatches.get(tip), files = match?.folder ? state.folderIndex.get(match.folder) || [] : [];
    if (!match?.folder) continue;
    if (!files.length) {
      const note = document.createElement("button"); note.type = "button"; note.className = "empty-note source-link"; note.textContent = "No photos in the matched folder.";
      note.title = `Show ${match.folder} in Finder`; note.addEventListener("click", () => nativePost("openPhotoFolder", { folderName: match.folder })); ui["photo-results"].append(note); continue;
    }
    count += files.length;
    const article = byId("photo-group-template").content.firstElementChild.cloneNode(true), heading = article.querySelector("h2"), source = document.createElement("button");
    source.type = "button"; source.className = "photo-source"; source.textContent = match.folder; source.title = `Show ${match.folder} in Finder`; source.addEventListener("click", () => nativePost("openPhotoFolder", { folderName: match.folder })); heading.replaceChildren(source);
    const stack = article.querySelector(".photo-stack");
    for (const [index,file] of files.entries()) {
      const figure = document.createElement("figure"), image = document.createElement("img"), caption = document.createElement("figcaption");
      const url = file.url || URL.createObjectURL(file);
      if (!file.url) state.imageUrls.push(url); if (progressive) { image.dataset.source = url; state.photoObserver.observe(image); } else image.src = url; image.alt = file.name; image.addEventListener("click", () => nativePost("showPhotoViewer", { urls: files.map(candidate => candidate.url).filter(Boolean), index })); image.addEventListener("dblclick", event => { event.preventDefault(); nativePost("openPhoto", { url: file.url || url }); }); caption.textContent = file.relativePath || file.webkitRelativePath || file.name; figure.append(image,caption); stack.append(figure);
    }
    ui["photo-results"].append(article);
  }
  if (!count && !ui["photo-results"].children.length) { const note = document.createElement("p"); note.className = "empty-note"; note.textContent = "No photos in the matched folder."; ui["photo-results"].append(note); }
}
function setSelection(names) { state.selectedTips = [...new Set((Array.isArray(names) ? names : []).filter(name => state.tips.includes(name)))]; renderPhotos(); }
function postViewer(message) { ui["tree-viewer"].contentWindow?.postMessage(message,window.location.origin); }
function requestPearTreeSelection(names) { if (!state.viewerReady) return; postViewer({ type:"phylophoto:select",tips:names || [] }); setSelection(names || []); }
function updateTipNavigator() {
  const query = ui["tree-tip-search"].value.trim().toLocaleLowerCase();
  const photoTips = state.tips.filter(name => { const match = state.folderMatches.get(name); return match?.status === "matched" && (state.folderIndex.get(match.folder) || []).length > 0; });
  state.tipNavigationMatches = query ? state.tips.filter(name => name.toLocaleLowerCase().includes(query)) : photoTips;
  state.tipNavigationIndex = query && state.tipNavigationMatches.length ? 0 : -1;
  const hasMatches = state.tipNavigationMatches.length > 0;
  ui["tree-tip-previous"].disabled = true; ui["tree-tip-next"].disabled = !hasMatches || (query && state.tipNavigationMatches.length === 1);
  ui["tree-tip-match-status"].textContent = query ? (hasMatches ? `1 / ${state.tipNavigationMatches.length}` : t("noMatchingTips")) : (hasMatches ? `${state.tipNavigationMatches.length} ${t("photoTipCount")}` : "");
  if (query && hasMatches) requestPearTreeSelection([state.tipNavigationMatches[0]]);
}
function moveTipNavigator(step) {
  const matches = state.tipNavigationMatches; if (!matches.length) return;
  const index = state.tipNavigationIndex + step;
  if (index < 0 || index >= matches.length) return;
  state.tipNavigationIndex = index;
  requestPearTreeSelection([matches[state.tipNavigationIndex]]);
  ui["tree-tip-match-status"].textContent = `${state.tipNavigationIndex + 1} / ${matches.length}`;
  ui["tree-tip-previous"].disabled = state.tipNavigationIndex === 0;
  ui["tree-tip-next"].disabled = state.tipNavigationIndex === matches.length - 1;
}
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

async function loadTreeText(text, filename, treePath = "") {
  state.sourceTree = extractNewick(text); state.rawTreeText = text; state.parsedTree = parseNewick(state.sourceTree); state.tips = collectTips(state.parsedTree); state.filename = filename; state.treePath = treePath; state.appliedRoot = null;
  ui["outgroup-search"].value = ""; setOutgroups([]); renderOutgroupPicker();
  ui["tree-name"].textContent = filename;
  ui["open-tree-default"].disabled = !treePath; ui["open-tree-text"].disabled = !treePath; ui["open-tree-export"].disabled = !treePath; ui["open-rename"].disabled = !treePath;
  ui["tree-tip-search"].disabled = false; ui["tree-tip-search"].value = ""; updateTipNavigator();
  for (const id of ["rename-mode","rename-search","rename-replacement","rename-photo-folders","rename-batch","preview-rename"]) ui[id].disabled = !treePath;
  for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","select-tip"]) ui[id].disabled = false;
  ui["create-tip-folders"].disabled = !state.tips.length;
  ui["tip-search"].value = ""; renderTipMatches();
  await mountTree(); updateFolderMatches(); setSelection([]); showStatus("");
}

function setRenameStatus(message, warning = false) { ui["rename-status"].textContent = message; ui["rename-status"].classList.toggle("warning", warning); ui["rename-status"].hidden = !message; }
function hideRenameSuggestions() { state.renameSuggestions = []; state.renameSuggestionIndex = -1; ui["rename-suggestions"].replaceChildren(); ui["rename-suggestions"].hidden = true; ui["rename-search"].setAttribute("aria-expanded", "false"); }
function renameSearchSuggestions() {
  const query = ui["rename-search"].value.trim();
  if (!query || !state.rawTreeText) return hideRenameSuggestions();
  try {
    const labels = listTreeLabels(state.rawTreeText);
    let matches;
    if (ui["rename-mode"].value === "regex") {
      const matcher = new RegExp(query);
      matches = labels.filter(label => { matcher.lastIndex = 0; return matcher.test(label); });
    } else {
      const normalized = query.toLocaleLowerCase();
      matches = labels.filter(label => label.toLocaleLowerCase().includes(normalized));
    }
    state.renameSuggestions = matches.slice(0, 50); state.renameSuggestionIndex = -1;
    ui["rename-suggestions"].replaceChildren(...state.renameSuggestions.map((label, index) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "rename-suggestion"; button.setAttribute("role", "option"); button.textContent = label;
      button.addEventListener("pointerdown", event => event.preventDefault());
      button.addEventListener("click", () => chooseRenameSuggestion(index));
      return button;
    }));
    ui["rename-suggestions"].hidden = !state.renameSuggestions.length;
    ui["rename-search"].setAttribute("aria-expanded", String(state.renameSuggestions.length > 0));
  } catch { hideRenameSuggestions(); }
}
function renderRenameSuggestionSelection() {
  [...ui["rename-suggestions"].children].forEach((button, index) => button.classList.toggle("is-active", index === state.renameSuggestionIndex));
  const active = ui["rename-suggestions"].children[state.renameSuggestionIndex]; active?.scrollIntoView({ block: "nearest" });
}
function chooseRenameSuggestion(index) { selectRenameLabel(state.renameSuggestions[index]); }
function selectRenameLabel(label) {
  if (!label) return;
  ui["rename-mode"].value = "literal"; ui["rename-search"].value = label; ui["rename-replacement"].value = label; ui["rename-batch"].value = ""; ui["rename-batch-panel"].open = false;
  resetRenamePanel(); state.renameSelectedLabel = label; ui["rename-source-label"].textContent = label; ui["rename-source"].hidden = false;
  hideRenameSuggestions(); searchRenameNodes(); ui["rename-replacement"].focus();
}
function hideReplacementSuggestions() { state.replacementSuggestions = []; state.replacementSuggestionIndex = -1; ui["rename-replacement-suggestions"].replaceChildren(); ui["rename-replacement-suggestions"].hidden = true; ui["rename-replacement"].setAttribute("aria-expanded", "false"); }
function replacementSuggestions() {
  const query = ui["rename-replacement"].value.trim().toLocaleLowerCase();
  const candidates = state.renameMatches || [];
  state.replacementSuggestions = (query ? candidates.filter(label => label.toLocaleLowerCase().includes(query)) : candidates).slice(0, 50);
  if (!state.replacementSuggestions.length) return hideReplacementSuggestions();
  state.replacementSuggestionIndex = -1;
  ui["rename-replacement-suggestions"].replaceChildren(...state.replacementSuggestions.map((label, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "rename-suggestion"; button.setAttribute("role", "option"); button.textContent = label;
    button.addEventListener("pointerdown", event => event.preventDefault()); button.addEventListener("click", () => chooseReplacementSuggestion(index)); return button;
  }));
  ui["rename-replacement-suggestions"].hidden = !state.replacementSuggestions.length;
  ui["rename-replacement"].setAttribute("aria-expanded", String(state.replacementSuggestions.length > 0));
}
function renderReplacementSuggestionSelection() { [...ui["rename-replacement-suggestions"].children].forEach((button, index) => button.classList.toggle("is-active", index === state.replacementSuggestionIndex)); ui["rename-replacement-suggestions"].children[state.replacementSuggestionIndex]?.scrollIntoView({ block:"nearest" }); }
function chooseReplacementSuggestion(index) { const label = state.replacementSuggestions[index]; if (!label) return; ui["rename-replacement"].value = label; resetRenamePreview(); hideReplacementSuggestions(); ui["rename-replacement"].focus(); }
function resetRenamePreview() { state.renamePreview = null; state.renameSaving = false; ui["rename-review"].hidden = true; ui["rename-actions"].hidden = true; ui["rename-preview"].hidden = true; ui["rename-preview-rows"].replaceChildren(); ui["apply-rename"].disabled = true; setRenameStatus(""); }
function resetRenamePanel() { state.renameMatches = null; state.renameSelectedLabel = null; ui["rename-source"].hidden = true; ui["rename-source-label"].textContent = ""; ui["rename-matches"].hidden = true; ui["rename-match-rows"].replaceChildren(); ui["rename-match-status"].hidden = true; ui["rename-match-status"].classList.remove("warning"); hideReplacementSuggestions(); resetRenamePreview(); }
function clearRenamePanel() { ui["rename-mode"].value = "literal"; ui["rename-search"].value = ""; ui["rename-replacement"].value = ""; ui["rename-photo-folders"].checked = true; ui["rename-batch"].value = ""; ui["rename-batch-panel"].open = false; hideRenameSuggestions(); hideReplacementSuggestions(); resetRenamePanel(); }
function searchRenameNodes() {
  try {
    const rules = parseRenameRules({ search: ui["rename-search"].value, replacement: "", batch: ui["rename-batch"].value, regex: ui["rename-mode"].value === "regex" });
    const matches = listTreeLabels(state.rawTreeText).filter(label => rules.some(rule => {
      if (!rule.matcher) return label.includes(rule.search);
      rule.matcher.lastIndex = 0; return rule.matcher.test(label);
    }));
    state.renameMatches = matches;
    const batchMode = Boolean(ui["rename-batch"].value.trim());
    ui["rename-match-rows"].replaceChildren(...matches.map(label => { const row = document.createElement("tr"), cell = document.createElement("td"); if (batchMode) cell.textContent = label; else { const button = document.createElement("button"); button.type = "button"; button.className = "rename-match"; button.textContent = label; button.addEventListener("click", () => selectRenameLabel(label)); cell.append(button); } row.append(cell); return row; }));
    ui["rename-matches"].hidden = !matches.length;
    ui["rename-match-status"].classList.remove("warning");
    ui["rename-match-status"].textContent = matches.length ? `${matches.length} ${t("matchingNodeCount")}` : t("noMatchingNodes");
    ui["rename-match-status"].hidden = false;
    if (document.activeElement === ui["rename-replacement"]) replacementSuggestions();
  } catch (error) { state.renameMatches = null; ui["rename-matches"].hidden = true; ui["rename-match-status"].textContent = error.message || String(error); ui["rename-match-status"].classList.add("warning"); ui["rename-match-status"].hidden = false; resetRenamePreview(); }
}
function buildRenamePreview() {
  if (!state.treePath || !state.rawTreeText) throw new Error("Open a tree file first.");
  if (!ui["rename-batch"].value.trim() && !state.renameSelectedLabel) throw new Error(t("selectNodeBeforePreview"));
  const rules = parseRenameRules({ search: ui["rename-search"].value, replacement: ui["rename-replacement"].value, batch: ui["rename-batch"].value, regex: ui["rename-mode"].value === "regex" });
  const result = renameTreeLabels(state.rawTreeText, rules);
  if (result.changes.length) parseNewick(extractNewick(result.text));
  return result;
}
function previewRename() {
  try {
    if (state.renameMatches === null) throw new Error(t("searchBeforePreview"));
    const result = buildRenamePreview(); state.renamePreview = result;
    ui["rename-preview-rows"].replaceChildren(...result.changes.map(change => { const row = document.createElement("tr"), before = document.createElement("td"), after = document.createElement("td"); before.textContent = change.before; after.textContent = change.after; row.append(before,after); return row; }));
    ui["rename-review"].hidden = false; ui["rename-preview"].hidden = !result.changes.length; ui["rename-actions"].hidden = !result.changes.length;
    setRenameStatus(result.changes.length ? `${result.changes.length} ${t("renamePreviewCount")}` : t("noRenameChanges"));
    ui["apply-rename"].disabled = !result.changes.length;
  } catch (error) { state.renamePreview = null; ui["rename-review"].hidden = false; ui["rename-actions"].hidden = true; ui["rename-preview"].hidden = true; ui["apply-rename"].disabled = true; setRenameStatus(error.message || String(error), true); }
}
function applyRename() {
  if (!state.renamePreview) return previewRename();
  const result = state.renamePreview;
  if (!result.changes.length) return;
  state.renameSaving = true; ui["apply-rename"].disabled = true; setRenameStatus("");
  nativePost("saveRenamedTree", { originalText: state.rawTreeText, updatedText: result.text, renamePhotoFolders: ui["rename-photo-folders"].checked, changes: result.changes.map(change => ({ before: change.before, after: change.after })) });
}

async function loadTree(file) {
  if (!file) return;
  try { await loadTreeText(await file.text(), file.name); }
  catch (error) { ui["tree-empty"].hidden = false; ui["tree-empty"].textContent = `Could not open tree: ${error.message || error}`; }
}

function receiveNativeMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "tree") {
    const completedRename = state.renameSaving;
    loadTreeText(message.text || "", message.filename || "tree.nwk", message.path || "").then(() => { if (completedRename) { clearRenamePanel(); setRenameDrawer(true); } }).catch(error => showStatus(`Could not open tree: ${error.message || error}`, true));
  } else if (message.type === "photoFolder") {
    state.photoFolderHandle = { native: true };
    setPhotoFiles(Array.isArray(message.files) ? message.files : [], message.name || "", Array.isArray(message.folders) ? message.folders : []);
  } else if (message.type === "recentPhotoFolders") {
    state.recentPhotoFolders = (Array.isArray(message.folders) ? message.folders : []).filter(folder => typeof folder?.name === "string" && typeof folder?.path === "string");
    renderRecentPhotoFolders();
  } else if (message.type === "foldersCreated") {
    const extra = Number(message.skipped || 0) ? `; skipped ${message.skipped} invalid label(s)` : "";
    const failures = Array.isArray(message.failed) && message.failed.length ? `; could not create ${message.failed.length}` : "";
    showStatus(`Created ${message.count || 0} tip folder(s)${extra}${failures}.`);
  } else if (message.type === "error") {
    state.renameSaving = false; ui["apply-rename"].disabled = !state.renamePreview?.changes.length;
    showStatus(message.message || "Native file operation failed.", true);
    if (ui["rename-drawer"].classList.contains("is-open")) setRenameStatus(message.message || "Native file operation failed.", true);
  }
}

window.PhyloPhotoNative = { receive: receiveNativeMessage };
function clearTree() {
  postViewer({ type:"phylophoto:clear" }); revokeImages(); hideRenameSuggestions(); hideReplacementSuggestions(); resetRenamePanel(); Object.assign(state,{ loadId:0,loadedId:0,currentSettings:{},sourceTree:"",rawTreeText:"",filename:"",treePath:"",parsedTree:null,tips:[],selectedTips:[],files:[],photoFolderHandle:null,photoFolderLoaded:false,folderIndex:new Map(),folderMatches:new Map(),appliedRoot:null,pendingRootReport:null,tipNavigationMatches:[],tipNavigationIndex:-1 });
  ui["tree-empty"].replaceChildren(treeEmptyArtwork); const button = document.createElement("button"); button.className = "button primary"; button.type = "button"; button.textContent = t("loadPhylogenyTree"); button.addEventListener("click", () => nativePost("chooseTree") || ui["tree-file"].click()); ui["tree-empty"].append(button); ui["tree-empty"].hidden = false;
  ui["photo-results"].replaceChildren(); ui["photo-empty"].hidden = false; ui["selection-summary"].textContent = ""; ui["tree-name"].textContent = ""; ui["open-tree-default"].disabled = true; ui["open-tree-text"].disabled = true; ui["open-tree-export"].disabled = true; ui["open-rename"].disabled = true; ui["tree-tip-search"].value = ""; ui["tree-tip-search"].disabled = true; ui["tree-tip-previous"].disabled = true; ui["tree-tip-next"].disabled = true; ui["tree-tip-match-status"].textContent = ""; ui["photo-folder-name"].textContent = ""; ui["folder-warning-panel"].hidden = true; showStatus("");
  for (const id of ["tree-file","photo-folder","tip-search","outgroup-search","multiple-outgroups"]) ui[id].value = "";
  ui["tip-matches"].replaceChildren(); renderOutgroupPicker();
  for (const id of ["clear-tree","rooting-mode","apply-root","tip-search","select-tip","refresh-photo-folder","create-tip-folders","rename-mode","rename-search","rename-replacement","rename-photo-folders","rename-batch","preview-rename","apply-rename"]) ui[id].disabled = true;
}
function updateMatchingControls() { const rule = ui["match-rule"].value; ui["delimiter-wrap"].hidden = rule !== "prefix"; ui["prefix-count-wrap"].hidden = rule !== "prefix"; ui["regex-wrap"].hidden = rule !== "regex"; }
function updateRootingControls() {
  const mode = ui["rooting-mode"].value;
  ui["outgroup-picker"].hidden = mode !== "single" && mode !== "multiple";
  if (mode === "single" && selectedOutgroups().length > 1) setOutgroups(selectedOutgroups().slice(0, 1));
  renderOutgroupPicker();
}
function startSplit(event) {
  if (event.button !== 0) return;
  event.preventDefault(); const splitter = ui.splitter; splitter.classList.add("dragging"); document.body.classList.add("dragging"); splitter.setPointerCapture?.(event.pointerId);
  const move = moveEvent => { const rect = ui.workspace.getBoundingClientRect(); setPanelPercent((moveEvent.clientX - rect.left) / rect.width * 100); };
  let finished = false;
  const stop = () => {
    if (finished) return; finished = true;
    splitter.classList.remove("dragging"); document.body.classList.remove("dragging"); window.removeEventListener("pointermove",move);
    splitter.removeEventListener("pointerup",stop); splitter.removeEventListener("pointercancel",stop); splitter.removeEventListener("lostpointercapture",stop);
    if (splitter.hasPointerCapture?.(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
    saveUiPreferences(); window.dispatchEvent(new Event("resize"));
  };
  window.addEventListener("pointermove",move); splitter.addEventListener("pointerup",stop,{ once:true }); splitter.addEventListener("pointercancel",stop,{ once:true }); splitter.addEventListener("lostpointercapture",stop,{ once:true });
}
function startDrawerResize(event) {
  if (event.button !== 0) return;
  event.preventDefault(); const resizer = event.currentTarget; document.body.classList.add("drawer-resizing"); resizer.setPointerCapture?.(event.pointerId);
  const move = moveEvent => setDrawerWidth(window.innerWidth - moveEvent.clientX);
  let finished = false;
  const stop = () => {
    if (finished) return; finished = true;
    document.body.classList.remove("drawer-resizing"); window.removeEventListener("pointermove",move);
    resizer.removeEventListener("pointerup",stop); resizer.removeEventListener("pointercancel",stop); resizer.removeEventListener("lostpointercapture",stop);
    if (resizer.hasPointerCapture?.(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
    saveUiPreferences();
  };
  window.addEventListener("pointermove",move); resizer.addEventListener("pointerup",stop,{ once:true }); resizer.addEventListener("pointercancel",stop,{ once:true }); resizer.addEventListener("lostpointercapture",stop,{ once:true });
}

ui["tree-file"].addEventListener("change",event => loadTree(event.target.files[0]));
ui["open-tree-empty"].addEventListener("click",() => nativePost("chooseTree") || ui["tree-file"].click());
ui["open-tree-default"].addEventListener("click",() => nativePost("openTree", { mode:"default" }));
ui["open-tree-text"].addEventListener("click",() => nativePost("openTree", { mode:"text" }));
ui["open-photo-empty"].addEventListener("click",choosePhotoFolder);
ui["open-tree-export"].addEventListener("click",() => postViewer({ type:"phylophoto:open-export" }));
ui["refresh-photo-folder"].addEventListener("click",refreshPhotoFolder);
ui["photo-folder"].addEventListener("change",event => { state.photoFolderHandle = null; setPhotoFiles([...event.target.files], event.target.files[0]?.webkitRelativePath?.split("/")[0] || ""); });
ui["open-settings"].addEventListener("click",() => setSettingsDrawer(!ui["settings-drawer"].classList.contains("is-open")));
ui["close-settings"].addEventListener("click",() => setSettingsDrawer(false));
ui["open-rename"].addEventListener("click",() => setRenameDrawer(!ui["rename-drawer"].classList.contains("is-open")));
ui["close-rename"].addEventListener("click",() => { clearRenamePanel(); setRenameDrawer(false); });
ui["cancel-rename"].addEventListener("click",() => { clearRenamePanel(); setRenameDrawer(false); });
ui["settings-scrim"].addEventListener("click",() => { if (!ui["rename-drawer"].classList.contains("is-open")) setSettingsDrawer(false); });
ui["app-language"].addEventListener("change",() => { localStorage.setItem("phylophoto-language", ui["app-language"].value); applyLanguage(); updateFolderMatches(); });
for (const resizer of [ui["drawer-resizer"],ui["rename-drawer-resizer"]]) {
  resizer.addEventListener("pointerdown",startDrawerResize);
  resizer.addEventListener("keydown",event => {
    if (! ["ArrowLeft","ArrowRight"].includes(event.key)) return;
    event.preventDefault(); setDrawerWidth(currentDrawerWidth() + (event.key === "ArrowLeft" ? 20 : -20)); saveUiPreferences();
  });
}
ui["clear-tree"].addEventListener("click",clearTree);
ui["tree-tip-search"].addEventListener("input", updateTipNavigator);
ui["tree-tip-search"].addEventListener("keydown", event => { if (event.key === "Enter" || event.key === "ArrowDown") { event.preventDefault(); moveTipNavigator(1); } else if (event.key === "ArrowUp") { event.preventDefault(); moveTipNavigator(-1); } });
ui["tree-tip-previous"].addEventListener("click", () => moveTipNavigator(-1));
ui["tree-tip-next"].addEventListener("click", () => moveTipNavigator(1));
function refreshRenameSearch() {
  resetRenamePanel(); renameSearchSuggestions();
  if (ui["rename-search"].value.trim() || ui["rename-batch"].value.trim()) searchRenameNodes();
}
for (const id of ["rename-mode","rename-search","rename-batch"]) {
  ui[id].addEventListener("input", refreshRenameSearch);
  ui[id].addEventListener("change", refreshRenameSearch);
}
ui["rename-search"].addEventListener("search", refreshRenameSearch);
ui["rename-search"].addEventListener("keydown", event => {
  if (event.key === "ArrowDown" && state.renameSuggestions.length) { event.preventDefault(); state.renameSuggestionIndex = Math.min(state.renameSuggestionIndex + 1, state.renameSuggestions.length - 1); renderRenameSuggestionSelection(); }
  else if (event.key === "ArrowUp" && state.renameSuggestions.length) { event.preventDefault(); state.renameSuggestionIndex = Math.max(state.renameSuggestionIndex - 1, 0); renderRenameSuggestionSelection(); }
  else if (event.key === "Enter" && state.renameSuggestionIndex >= 0) { event.preventDefault(); chooseRenameSuggestion(state.renameSuggestionIndex); }
  else if (event.key === "Escape") { event.preventDefault(); hideRenameSuggestions(); }
});
ui["rename-search"].addEventListener("blur", () => setTimeout(hideRenameSuggestions, 120));
for (const id of ["rename-replacement","rename-photo-folders"]) {
  ui[id].addEventListener("input", resetRenamePreview);
  ui[id].addEventListener("change", resetRenamePreview);
}
ui["rename-replacement"].addEventListener("input", replacementSuggestions);
ui["rename-replacement"].addEventListener("focus", replacementSuggestions);
ui["rename-replacement"].addEventListener("search", () => { resetRenamePreview(); replacementSuggestions(); });
ui["rename-replacement"].addEventListener("keydown", event => {
  if (event.key === "ArrowDown" && state.replacementSuggestions.length) { event.preventDefault(); state.replacementSuggestionIndex = Math.min(state.replacementSuggestionIndex + 1, state.replacementSuggestions.length - 1); renderReplacementSuggestionSelection(); }
  else if (event.key === "ArrowUp" && state.replacementSuggestions.length) { event.preventDefault(); state.replacementSuggestionIndex = Math.max(state.replacementSuggestionIndex - 1, 0); renderReplacementSuggestionSelection(); }
  else if (event.key === "Enter" && state.replacementSuggestionIndex >= 0) { event.preventDefault(); chooseReplacementSuggestion(state.replacementSuggestionIndex); }
  else if (event.key === "Escape") { event.preventDefault(); hideReplacementSuggestions(); }
});
ui["rename-replacement"].addEventListener("blur", () => setTimeout(hideReplacementSuggestions, 120));
ui["preview-rename"].addEventListener("click",previewRename);
ui["apply-rename"].addEventListener("click",applyRename);
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
ui["create-tip-folders"].addEventListener("click",() => {
  if (!state.tips.length) return;
  nativePost("chooseTipFolderDestination", { tips: state.tips });
});
ui["lazy-photo-loading"].addEventListener("change",() => { saveUiPreferences(); renderPhotos(); });
ui.splitter.addEventListener("keydown",event => { if (!["ArrowLeft","ArrowRight"].includes(event.key)) return; event.preventDefault(); setPanelPercent(panelPercent() + (event.key === "ArrowRight" ? 2 : -2)); saveUiPreferences(); });
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
  } else if (message.type === "phylophoto:export-tree") {
    // This arrives from the embedded PearTree frame.  Send its completed
    // export text on to the native bridge, which presents macOS Save As.
    nativePost("saveExportedTree", { content: message.content, filename: message.filename, mimeType: message.mimeType });
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
window.addEventListener("beforeunload",revokeImages); restoreUiPreferences(); applyLanguage(); setDrawerWidth(currentDrawerWidth()); updateRootingControls(); nativePost("loadRecentPhotoFolders"); postViewer({ type:"phylophoto:ping" });
window.addEventListener("keydown",event => {
  if (event.key === "Escape" && !ui["rename-drawer"].classList.contains("is-open")) {
    setSettingsDrawer(false);
    return;
  }
  if (! ["ArrowLeft", "ArrowRight"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
  if (ui["settings-drawer"].classList.contains("is-open") || ui["rename-drawer"].classList.contains("is-open")) return;
  if (ui["tree-tip-previous"].disabled && ui["tree-tip-next"].disabled) return;
  event.preventDefault();
  moveTipNavigator(event.key === "ArrowRight" ? 1 : -1);
});
window.addEventListener("resize",() => setDrawerWidth(currentDrawerWidth()));
