"use strict";

const viewer = document.getElementById("peartree-viewer");
const errorBox = document.getElementById("peartree-error");
let controller = null;
let unsubscribeSelection = null;
let settingsPoller = null;
let settingsKey = "";

function send(type, extra = {}) {
  window.parent.postMessage({ type, ...extra }, window.location.origin);
}

function normaliseTips(value) {
  return Array.isArray(value) ? [...new Set(value.filter(name => typeof name === "string"))] : [];
}

function showError(error) {
  viewer.hidden = true;
  errorBox.hidden = false;
  errorBox.textContent = `PearTree could not render this tree.\n\n${error?.message || error}`;
  send("phylophoto:error", { message: error?.message || String(error) });
}

function applySelection(value) {
  const names = normaliseTips(value);
  controller?.getSelectionChangedListener?.()(names.length ? names : null);
}

async function mountTree(args) {
  if (!window.PearTreeEmbed) throw new Error("The local PearTree bundle did not load.");
  unsubscribeSelection?.();
  window.clearInterval(settingsPoller);
  controller?.destroy?.();
  viewer.replaceChildren();
  viewer.hidden = false;
  errorBox.hidden = true;

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
      ...(args.settings || {}),
    },
    paletteSections: "all",
    appSections: ["toolbar", "canvasContainer", "statusBar", "modals", "palette"],
    ui: {
      theme: args.theme === "dark" ? "dark" : "light",
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

  unsubscribeSelection = controller.onSelectionChanged(tips => {
    send("phylophoto:selection", { tips: normaliseTips(tips) });
  });
  let notified = false;
  const notifyLoaded = () => {
    if (notified) return;
    notified = true;
    send("phylophoto:tree-loaded", { loadId: args.loadId });
  };
  controller.onTreeLoad(notifyLoaded);
  window.setTimeout(notifyLoaded, 0);
  settingsKey = JSON.stringify(controller.getSettings?.() || {});
  settingsPoller = window.setInterval(() => {
    const settings = controller?.getSettings?.() || {};
    const key = JSON.stringify(settings);
    if (key === settingsKey) return;
    settingsKey = key;
    send("phylophoto:settings-changed", { settings });
  }, 800);
}

function applyRoot(request, attempt = 0) {
  if (!controller) return;
  if (request.mode === "midpoint") {
    controller.midpointRoot();
    window.setTimeout(() => send("phylophoto:root-applied", { request }), 150);
    return;
  }
  applySelection(request.names);
  const button = viewer.querySelector("#btn-reroot");
  if ((!button || button.disabled) && attempt < 20) {
    window.setTimeout(() => applyRoot(request, attempt + 1), 50);
    return;
  }
  if (!button || button.disabled) {
    send("phylophoto:root-error", { message: "PearTree could not reroot on this selection." });
    return;
  }
  button.click();
  window.setTimeout(() => send("phylophoto:root-applied", { request }), 150);
}

window.addEventListener("message", async event => {
  if (event.origin !== window.location.origin) return;
  const message = event.data || {};
  try {
    if (message.type === "phylophoto:ping") send("phylophoto:ready");
    else if (message.type === "phylophoto:load-tree") await mountTree(message);
    else if (message.type === "phylophoto:select") applySelection(message.tips);
    else if (message.type === "phylophoto:root") applyRoot(message.request);
    else if (message.type === "phylophoto:get-settings") {
      send("phylophoto:settings", { requestId: message.requestId, settings: controller?.getSettings?.() || {} });
    } else if (message.type === "phylophoto:clear") {
      unsubscribeSelection?.();
      window.clearInterval(settingsPoller);
      controller?.destroy?.();
      controller = null;
      viewer.replaceChildren();
    }
  } catch (error) {
    showError(error);
  }
});

send("phylophoto:ready");
