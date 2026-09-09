const viewer = document.getElementById("peartree-viewer");
const errorBox = document.getElementById("peartree-error");

let controller = null;
let unsubscribeSelection = null;
let currentTreeKey = null;
let selectedTipsKey = "";

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

function applySelection(tips) {
  if (!controller) return;
  const names = normaliseTips(tips);
  const key = JSON.stringify(names);
  if (key === selectedTipsKey) return;
  selectedTipsKey = key;
  controller.getSelectionChangedListener()(names.length ? names : null);
}

async function mountPearTree(args, theme) {
  if (!window.PearTreeEmbed) {
    throw new Error("The local PearTree bundle did not load.");
  }

  unsubscribeSelection?.();
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

  unsubscribeSelection = controller.onSelectionChanged((tips) => {
    const names = normaliseTips(tips);
    selectedTipsKey = JSON.stringify(names);
    setComponentValue({ tips: names });
  });

  const requested = normaliseTips(args.selectedTips);
  controller.onTreeLoad(() => {
    selectedTipsKey = "";
    applySelection(requested);
  });
  // Inline Newick can finish loading before onTreeLoad is registered.
  window.setTimeout(() => applySelection(requested), 0);
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
    }
  } catch (error) {
    showError(error);
  }
});

postStreamlitMessage("streamlit:componentReady", { apiVersion: 1 });
