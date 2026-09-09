const viewer = document.getElementById("peartree-viewer");
const errorBox = document.getElementById("peartree-error");

let controller = null;
let unsubscribeSelection = null;
let currentTreeKey = null;
let selectedTipsKey = "";
let currentTips = [];
let settingsPoller = null;
let settingsKey = "";
let lastSettingsSaveRequest = 0;
let lastRootRequest = 0;
let pendingSnapshot = 0;

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

function saveSettingsSnapshot(requestId) {
  if (!controller || !requestId || requestId <= lastSettingsSaveRequest) return;
  lastSettingsSaveRequest = requestId;
  const settings = getSettings();
  settingsKey = JSON.stringify(settings);
  pendingSnapshot = requestId;
  const button = viewer.querySelector("#btn-export-tree");
  if (!button || button.disabled) {
    reportValue(currentTips, settings, { settingsSnapshot: { requestId, settings } });
    return;
  }
  button.click();
  const nexus = viewer.querySelector('input[name="exp-format"][value="nexus"]');
  if (nexus) { nexus.checked = true; nexus.dispatchEvent(new Event("change", { bubbles: true })); }
  const state = viewer.querySelector("#exp-store-state");
  if (state) state.checked = false;
  const mode = viewer.querySelector("#exp-store-settings-mode");
  if (mode) mode.value = "none";
  const full = viewer.querySelector('input[name="exp-scope"][value="full"]');
  if (full) full.checked = true;
  viewer.querySelector("#exp-all-btn")?.click();
  viewer.querySelector("#exp-download-btn")?.click();
}

function applyRootRequest(request, attempt = 0) {
  const requestId = Number(request?.requestId) || 0;
  if (!controller || !requestId || requestId <= lastRootRequest) return;
  if (request?.mode === "midpoint") {
    lastRootRequest = requestId;
    controller.midpointRoot();
    window.setTimeout(() => reportValue(currentTips, getSettings(), {
      rootApplied: { requestId, mode: "midpoint", tips: [] },
    }), 150);
    return;
  }
  const names = normaliseTips(request?.tips);
  applySelection(names);
  const button = viewer.querySelector("#btn-reroot");
  if ((!button || button.disabled) && attempt < 20) {
    window.setTimeout(() => applyRootRequest(request, attempt + 1), 50);
    return;
  }
  lastRootRequest = requestId;
  if (!names.length || !button || button.disabled) {
    reportValue(currentTips, getSettings(), {
      rootApplied: { requestId, tips: names, error: "PearTree could not reroot on this selection." },
    });
    return;
  }
  button.click();
  window.setTimeout(() => reportValue(currentTips, getSettings(), {
    rootApplied: { requestId, mode: "selection", tips: names },
  }), 150);
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
  lastRootRequest = 0;

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

  if (typeof window.peartree?.setExportSaveHandler === "function") {
    window.peartree.setExportSaveHandler(payload => {
      const requestId = pendingSnapshot;
      pendingSnapshot = 0;
      reportValue(currentTips, getSettings(), {
        settingsSnapshot: { requestId, settings: getSettings(), treeContent: payload?.content },
      });
    });
  }

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
    saveSettingsSnapshot(Number(args.settingsSaveRequest) || 0);
    applyRootRequest(args.rootRequest || {});
  } catch (error) {
    showError(error);
  }
});

postStreamlitMessage("streamlit:componentReady", { apiVersion: 1 });
