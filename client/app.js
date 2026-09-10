"use strict";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/tiff", "image/bmp"]);
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|tiff?|bmp)$/i;
const ui = {
  treeInput: document.querySelector("#tree-file"),
  emptyTreeInput: document.querySelector("#tree-file-empty"),
  clear: document.querySelector("#clear-tree"),
  workspace: document.querySelector("#workspace"),
  empty: document.querySelector("#empty-state"),
  bottom: document.querySelector("#bottom-controls"),
  treeName: document.querySelector("#tree-name"),
  treeViewer: document.querySelector("#tree-viewer"),
  photoInput: document.querySelector("#photo-folder"),
  photoFolderName: document.querySelector("#photo-folder-name"),
  matchRule: document.querySelector("#match-rule"),
  prefixCount: document.querySelector("#prefix-count"),
  prefixCountWrap: document.querySelector("#prefix-count-wrap"),
  folderWarning: document.querySelector("#folder-warning"),
  summary: document.querySelector("#selection-summary"),
  results: document.querySelector("#photo-results"),
  splitter: document.querySelector("#splitter"),
  resetView: document.querySelector("#reset-tree-view"),
};

let controller = null;
let unsubscribeSelection = null;
let tips = [];
let selectedTips = [];
let folderFiles = [];
let imageUrls = [];

function showError(message) {
  ui.summary.textContent = message;
  ui.results.replaceChildren();
}

function extractNewick(text) {
  const nexusTree = text.match(/\btree\s+[^=]+?=\s*([^;]+;)/i);
  if (nexusTree) return nexusTree[1];
  const firstTree = text.match(/\([^;]+;/s);
  if (!firstTree) throw new Error("No Newick tree was found in this file.");
  return firstTree[0];
}

function extractTipLabels(newick) {
  const labels = [];
  let index = 0;
  let expectsLeafLabel = true;
  const delimiters = new Set(["(", ")", ",", ":", ";"]);
  while (index < newick.length) {
    const char = newick[index];
    if (char === "(") { expectsLeafLabel = true; index += 1; continue; }
    if (char === ")") { expectsLeafLabel = false; index += 1; continue; }
    if (char === ",") { expectsLeafLabel = true; index += 1; continue; }
    if (char === ":") {
      index += 1;
      while (index < newick.length && ![",", ")", ";"].includes(newick[index])) index += 1;
      continue;
    }
    if (/\s/.test(char) || char === ";") { index += 1; continue; }
    if (char === "[") { const end = newick.indexOf("]", index + 1); index = end < 0 ? newick.length : end + 1; continue; }
    let label = "";
    if (char === "'") {
      index += 1;
      while (index < newick.length && newick[index] !== "'") label += newick[index++];
      index += 1;
    } else {
      while (index < newick.length && !delimiters.has(newick[index]) && !/\s/.test(newick[index])) label += newick[index++];
    }
    if (label && expectsLeafLabel) labels.push(label);
    expectsLeafLabel = false;
  }
  return [...new Set(labels)];
}

function cleanSelection(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(name => tips.includes(name)))];
}

function tipKey(tip) {
  if (ui.matchRule.value === "full") return tip;
  const count = Math.max(1, Number(ui.prefixCount.value) || 1);
  return tip.split("_").slice(0, count).join("_");
}

function relativePathWithinPhotoRoot(file) {
  const parts = (file.webkitRelativePath || file.name).split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : file.name;
}

function directFolderNames() {
  const names = new Set();
  folderFiles.forEach(file => {
    const parts = relativePathWithinPhotoRoot(file).split("/");
    if (parts.length > 1 && parts[0]) names.add(parts[0]);
  });
  return names;
}

function filesForTip(tip) {
  const key = tipKey(tip).toLocaleLowerCase();
  const matchingFolders = [...directFolderNames()].filter(folder => folder.toLocaleLowerCase() === key);
  if (matchingFolders.length !== 1) return { folders: matchingFolders, files: [] };
  const folder = matchingFolders[0];
  const files = folderFiles.filter(file => {
    const relative = relativePathWithinPhotoRoot(file);
    const isImage = IMAGE_TYPES.has(file.type) || IMAGE_EXTENSIONS.test(file.name);
    return relative.startsWith(`${folder}/`) && isImage;
  });
  return { folders: matchingFolders, files };
}

function renderFolderWarnings() {
  if (!folderFiles.length || !tips.length) { ui.folderWarning.hidden = true; return; }
  const folders = directFolderNames();
  const missing = tips.filter(tip => !folders.has(tipKey(tip)));
  ui.folderWarning.hidden = missing.length === 0;
  ui.folderWarning.textContent = missing.length
    ? `${missing.length} tip folder(s) do not match the selected rule. The browser cannot create folders in a webkitdirectory selection; create them locally if needed.`
    : "";
}

function revokeImageUrls() {
  imageUrls.forEach(URL.revokeObjectURL);
  imageUrls = [];
}

function renderPhotos() {
  revokeImageUrls();
  ui.results.replaceChildren();
  if (!selectedTips.length) { ui.summary.textContent = "Select a tip or internal node in the tree."; return; }
  ui.summary.textContent = selectedTips.length === 1
    ? `Tip — ${selectedTips[0]}`
    : `Selected node — ${selectedTips.length} descendant tips`;
  if (!folderFiles.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Choose a local photo folder to show photos for this selection.";
    ui.results.append(note);
    return;
  }
  let count = 0;
  selectedTips.forEach(tip => {
    const result = filesForTip(tip);
    if (!result.files.length) return;
    count += result.files.length;
    const article = document.querySelector("#photo-group-template").content.firstElementChild.cloneNode(true);
    article.querySelector("h2").textContent = tip;
    const stack = article.querySelector(".photo-stack");
    result.files.forEach(file => {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      const url = URL.createObjectURL(file);
      imageUrls.push(url);
      image.src = url;
      image.alt = file.name;
      const caption = document.createElement("figcaption");
      caption.textContent = file.webkitRelativePath || file.name;
      figure.append(image, caption);
      stack.append(figure);
    });
    ui.results.append(article);
  });
  if (!count) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No supported photos were found for the selected tip folder(s).";
    ui.results.append(note);
  }
}

async function loadTree(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const newick = extractNewick(text);
    const nextTips = extractTipLabels(newick);
    if (!nextTips.length) throw new Error("No named tips were found in this tree.");
    unsubscribeSelection?.();
    controller?.destroy?.();
    ui.treeViewer.replaceChildren();
    tips = nextTips;
    selectedTips = [];
    controller = await window.PearTreeEmbed.embed({
      container: ui.treeViewer,
      tree: newick,
      filename: file.name,
      nodeLabelName: "bootstrap",
      storageKey: "phylophoto-client-peartree-settings",
      height: "100%",
      settings: { branchLabelAnnotation: "bootstrap", introAnimation: "none", paddingLeft: "4", paddingRight: "4", paddingTop: "4", paddingBottom: "4" },
      paletteSections: "all",
      appSections: ["toolbar", "canvasContainer", "statusBar", "modals", "palette"],
      ui: { palette: true, toolbar: true, statusBar: true, openTree: false, import: false, export: false, rtt: false, dataTable: false, help: false, about: false, brand: false, toolbarSections: "all" },
    });
    unsubscribeSelection = controller.onSelectionChanged(selection => {
      selectedTips = cleanSelection(selection);
      renderPhotos();
    });
    ui.treeName.textContent = file.name;
    ui.treeName.hidden = false;
    ui.workspace.hidden = false;
    ui.bottom.hidden = false;
    ui.empty.hidden = true;
    ui.clear.disabled = false;
    renderFolderWarnings();
    renderPhotos();
  } catch (error) {
    showError(`Could not open tree: ${error.message || error}`);
  }
}

function clearTree() {
  unsubscribeSelection?.();
  controller?.destroy?.();
  controller = null;
  tips = [];
  selectedTips = [];
  revokeImageUrls();
  ui.treeViewer.replaceChildren();
  ui.results.replaceChildren();
  ui.workspace.hidden = true;
  ui.bottom.hidden = true;
  ui.empty.hidden = false;
  ui.treeName.hidden = true;
  ui.clear.disabled = true;
  ui.treeInput.value = "";
  ui.emptyTreeInput.value = "";
}

function startSplit(event) {
  event.preventDefault();
  ui.splitter.classList.add("dragging");
  const workspace = ui.workspace;
  const move = moveEvent => {
    const rect = workspace.getBoundingClientRect();
    const percentage = Math.min(75, Math.max(25, ((moveEvent.clientX - rect.left) / rect.width) * 100));
    workspace.style.gridTemplateColumns = `minmax(320px, ${percentage}fr) 9px minmax(320px, ${100 - percentage}fr)`;
  };
  const stop = () => { ui.splitter.classList.remove("dragging"); window.removeEventListener("pointermove", move); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

ui.treeInput.addEventListener("change", event => loadTree(event.target.files[0]));
ui.emptyTreeInput.addEventListener("change", event => loadTree(event.target.files[0]));
ui.clear.addEventListener("click", clearTree);
ui.photoInput.addEventListener("change", event => {
  folderFiles = [...event.target.files];
  const name = folderFiles[0]?.webkitRelativePath?.split("/")[0] || "No folder selected";
  ui.photoFolderName.textContent = `${name} (${folderFiles.length} local files)`;
  renderFolderWarnings();
  renderPhotos();
});
ui.matchRule.addEventListener("change", () => { ui.prefixCountWrap.hidden = ui.matchRule.value !== "prefix"; renderFolderWarnings(); renderPhotos(); });
ui.prefixCount.addEventListener("input", () => { renderFolderWarnings(); renderPhotos(); });
ui.splitter.addEventListener("pointerdown", startSplit);
ui.resetView.addEventListener("click", () => {
  localStorage.removeItem("phylophoto-client-peartree-settings");
  window.alert("PearTree visual settings were reset. Reload the selected tree to apply them.");
});
window.addEventListener("beforeunload", revokeImageUrls);
