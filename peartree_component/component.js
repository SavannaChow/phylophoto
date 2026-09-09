const viewer = document.getElementById("peartree-viewer");
const errorBox = document.getElementById("peartree-error");

let controller = null;
let unsubscribeSelection = null;
let currentTreeKey = null;
let selectedTipsKey = "";
let currentTips = [];
let settingsPoller = null;
let settingsKey = "";
let lastExportRequest = 0;
let pendingExportRequest = 0;

function postStreamlitMessage(type, extra = {}) {
  window.parent.postMessage({
    isStreamlitMessage: true,
    type,
    ...extra,
  }, "*");
}

function setComponentValue(value) {
  postStreamlitMessage("streamlit:setComponentValue", {
    value,
    dataType: "json",
  });
}

function showError(error) {
  viewer.hidden = true;
  errorBox.hidden = false;
  errorBox.textContent = `PearTree could not render this tree.\n\n${error?.message || error}`;
}

function normaliseTips(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(name => typeof name === "string"))];
}

function tipsKey(names) {
  return JSON.stringify([...names].sort());
}

function getSettings() {
  const settings = controller?.getSettings?.();
  return settings && typeof settings === "object" ? settings : {};
}

function reportValue(names, settings = getSettings(), extra = {}) {
  setComponentValue({ tips: names, settings, ...extra });
}

function installExportHandler() {
  if (typeof window.peartree?.setExportSaveHandler !== "function") return;
  window.peartree.setExportSaveHandler(payload => {
    const requestId = pendingExportRequest;
    pendingExportRequest = 0;
    reportValue(currentTips, getSettings(), {
      treeExport: { ...payload, requestId },
    });
  });
}

function exportCurrentTree(requestId, attempt = 0) {
  if (!controller || !requestId || requestId <= lastExportRequest) return;
  const exportButton = viewer.querySelector("#btn-export-tree");
  if ((!exportButton || exportButton.disabled) && attempt < 50) {
    window.setTimeout(() => exportCurrentTree(requestId, attempt + 1), 100);
    return;
  }
  lastExportRequest = requestId;
  if (!exportButton || exportButton.disabled) {
    reportValue(currentTips, getSettings(), {
      treeExport: { requestId, error: "PearTree's exporter was not ready." },
    });
    return;
  }

  pendingExportRequest = requestId;
  exportButton.click();
  const nexus = viewer.querySelector('input[name="exp-format"][value="nexus"]');
  if (nexus) {
    nexus.checked = true;
    nexus.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const settingsMode = viewer.querySelector("#exp-store-settings-mode");
  if (settingsMode) settingsMode.value = "all";
  const fullScope = viewer.querySelector('input[name="exp-scope"][value="full"]');
  if (fullScope) fullScope.checked = true;
  const tipLabels = viewer.querySelector("#exp-tip-label-sel");
  if (tipLabels && [...tipLabels.options].some(option => option.value === "name")) {
    tipLabels.value = "name";
  }
  const downloadButton = viewer.querySelector("#exp-download-btn");
  if (!downloadButton) {
    pendingExportRequest = 0;
    reportValue(currentTips, getSettings(), {
      treeExport: { requestId, error: "PearTree did not open its export dialog." },
    });
    return;
  }
  downloadButton.click();
}

function startSettingsWatcher() {
  window.clearInterval(settingsPoller);
  settingsKey = JSON.stringify(getSettings());
  settingsPoller = window.setInterval(() => {
    if (!controller) return;
    const settings = getSettings();
    const key = JSON.stringify(settings);
    if (key === settingsKey) return;
    settingsKey = key;
    reportValue(currentTips, settings);
  }, 800);
}

function applySelection(tips) {
  if (!controller) return;
  const names = normaliseTips(tips);
  const key = tipsKey(names);
  if (key === selectedTipsKey) return;
  selectedTipsKey = key;
  currentTips = names;
  controller.getSelectionChangedListener()(names.length ? names : null);
}

async function mountPearTree(args, theme) {
  if (!window.PearTreeEmbed) {
    throw new Error("The local PearTree bundle did not load.");
  }

  unsubscribeSelection?.();
  window.clearInterval(settingsPoller);
  viewer.replaceChildren();
  viewer.hidden = false;
  errorBox.hidden = true;
  selectedTipsKey = "";

  controller = await window.PearTreeEmbed.embed({
    container: viewer,
    tree: args.tree,
    filename: args.filename || "tree.nwk",
    nodeLabelName: "bootstrap",
    storageKey: "uce-photo-peartree-settings",
    height: "100%",
    settings: {
      branchLabelAnnotation: "bootstrap",
      introAnimation: "none",
      paddingLeft: "4",
      paddingRight: "4",
      paddingTop: "4",
      paddingBottom: "4",
      ...(args.settings && typeof args.settings === "object" ? args.settings : {}),
    },
    paletteSections: "all",
    appSections: ["toolbar", "canvasContainer", "statusBar", "modals", "palette"],
    ui: {
      theme: theme === "dark" ? "dark" : "light",
      palette: true,
      toolbar: true,
      statusBar: true,
      openTree: false,
      import: false,
      export: false,
      rtt: false,
      dataTable: false,
      help: false,
      about: false,
      brand: false,
      toolbarSections: "all",
    },
  });

  installExportHandler();

  unsubscribeSelection = controller.onSelectionChanged((tips) => {
    const names = normaliseTips(tips);
    const key = tipsKey(names);
    // Do not echo Python's programmatic selection back to Streamlit. That
    // creates a rerun loop when the component iframe is rebuilt.
    if (key === selectedTipsKey) return;
    selectedTipsKey = key;
    currentTips = names;
    reportValue(names);
  });

  const requested = normaliseTips(args.selectedTips);
  controller.onTreeLoad(() => {
    selectedTipsKey = "";
    applySelection(requested);
  });
  // Inline Newick can finish loading before onTreeLoad is registered.
  window.setTimeout(() => applySelection(requested), 0);
  startSettingsWatcher();
}

window.addEventListener("message", async event => {
  if (event.data?.type !== "streamlit:render") return;
  const args = event.data.args || {};
  const theme = event.data.theme?.base || "light";
  const treeKey = `${theme}\n${args.filename || ""}\n${args.tree || ""}`;

  try {
    if (!controller || treeKey !== currentTreeKey) {
      currentTreeKey = treeKey;
      await mountPearTree(args, theme);
    } else {
      applySelection(args.selectedTips);
      if (args.settings && typeof args.settings === "object") {
        const incomingKey = JSON.stringify(args.settings);
        if (incomingKey !== settingsKey) {
          controller.applySettings(args.settings);
          settingsKey = JSON.stringify(getSettings());
        }
      }
    }
    exportCurrentTree(Number(args.exportRequest) || 0);
  } catch (error) {
    showError(error);
  }
});

postStreamlitMessage("streamlit:componentReady", { apiVersion: 1 });
