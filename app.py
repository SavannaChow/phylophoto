"""Local Streamlit phylogeny and sample-photo browser using PearTree."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from peartree_component import peartree_viewer
from tree_utils import (
    folder_is_effectively_empty,
    initialise_photo_library,
    match_photo_folders,
    parse_newick,
    photo_files,
    photo_folder_labels,
    tip_labels,
    tree_to_newick,
)


APP_DIR = Path(__file__).resolve().parent
DEFAULT_TREE = APP_DIR / "edge-incomplete-min_taxa_050.charsets.renamed_species_accession_geo_srr_gca_species_updated.tree"


st.set_page_config(page_title="Phylogeny photo browser", page_icon="🌿", layout="wide")
st.markdown(
    """
    <style>
    [data-testid="stMainBlockContainer"] {
        padding-top: .5rem !important;
        padding-bottom: 1rem !important;
    }
    [data-testid="stHeader"] {
        height: 3rem;
        min-height: 3rem;
        background: transparent;
    }
    [data-testid="stHeading"]:has(h1) { margin-top: -1rem; }
    [data-testid="stMainBlockContainer"] h1 {
        font-size: 1.5rem !important;
        line-height: 1.15;
        padding-top: .3rem;
        padding-bottom: .25rem;
    }

    div[data-testid="stHorizontalBlock"]:has(#phylogeny-tree-panel) {
        gap: 0;
        align-items: stretch;
        position: relative;
    }
    div[data-testid="stHorizontalBlock"]:has(#phylogeny-tree-panel) > div[data-testid="stColumn"]:first-child,
    .phylogeny-left-panel {
        flex: 0 0 56%;
        width: auto !important;
        min-width: 0 !important;
        max-width: calc(75% - 5px);
        height: calc(100vh - 5rem);
        height: calc(100dvh - 5rem);
        min-height: 480px;
        overflow: hidden;
        border: 1px solid rgba(128, 128, 128, .35);
        border-radius: .55rem;
        padding: 0;
    }
    .phylogeny-left-panel > div[data-testid="stVerticalBlock"],
    .phylogeny-left-panel > div[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlockBorderWrapper"],
    .phylogeny-left-panel [data-testid="stCustomComponentV1"] {
        min-width: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
        gap: 0 !important;
    }
    div[data-testid="stHorizontalBlock"]:has(#phylogeny-tree-panel) > div[data-testid="stColumn"]:first-child iframe,
    .phylogeny-left-panel iframe {
        display: block;
        width: 100% !important;
        min-width: 0 !important;
        height: calc(100vh - 5rem - 2px) !important;
        height: calc(100dvh - 5rem - 2px) !important;
        min-height: 478px !important;
        border: 0 !important;
    }
    div[data-testid="stHorizontalBlock"]:has(#phylogeny-tree-panel) > div[data-testid="stColumn"]:last-child,
    .phylogeny-right-panel {
        flex: 1 1 auto;
        width: auto !important;
        min-width: 0 !important;
        height: calc(100vh - 5rem);
        height: calc(100dvh - 5rem);
        min-height: 480px;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        border: 1px solid rgba(128, 128, 128, .35);
        border-radius: .55rem;
        padding: .5rem .9rem;
    }
    .phylogeny-splitter {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 10px;
        margin-left: -5px;
        z-index: 20;
        cursor: col-resize;
        touch-action: none;
        user-select: none;
    }
    .phylogeny-drag-shield {
        position: absolute;
        inset: 0;
        z-index: 19;
        cursor: col-resize;
    }
    .phylogeny-splitter::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 4px;
        width: 2px;
        border-radius: 2px;
        background: #cbd5e1;
        transition: width .12s, left .12s, background .12s;
    }
    .phylogeny-splitter:hover::after,
    .phylogeny-splitter.is-dragging::after {
        left: 3px;
        width: 4px;
        background: #2563eb;
    }
    body:has(.phylogeny-splitter.is-dragging) {
        cursor: col-resize !important;
        user-select: none !important;
    }
    #phylogeny-tree-panel, #sample-photo-panel { display: none; }
    </style>
    """,
    unsafe_allow_html=True,
)
st.title("Phylogeny photo browser")


def read_uploaded_or_default(uploaded_file) -> tuple[str, str]:
    if uploaded_file is not None:
        return uploaded_file.getvalue().decode("utf-8-sig"), uploaded_file.name
    if DEFAULT_TREE.exists():
        return DEFAULT_TREE.read_text(encoding="utf-8-sig"), DEFAULT_TREE.name
    raise ValueError("Upload a Newick tree file.")


def choose_photo_root() -> None:
    """Open the native macOS folder chooser and store the selected path."""
    if sys.platform != "darwin":
        st.session_state.folder_picker_error = "The Choose folder button currently requires macOS; enter the path above."
        return
    script = (
        'tell application "Finder"\n'
        "activate\n"
        'set selectedFolder to choose folder with prompt "Choose the folder containing sample photo folders"\n'
        "return POSIX path of selectedFolder\n"
        "end tell"
    )
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        st.session_state.folder_picker_error = f"Could not open the folder chooser: {exc}"
        return
    if result.returncode == 0 and result.stdout.strip():
        st.session_state.photo_root_input = result.stdout.strip()
        st.session_state.folder_picker_error = ""
    elif "User canceled" not in result.stderr:
        st.session_state.folder_picker_error = result.stderr.strip() or "No folder was selected."


with st.sidebar:
    st.header("Inputs")
    uploaded_tree = st.file_uploader("Newick tree", type=["nwk", "newick", "tree", "tre"])
    clear_current_tree = st.button("Clear current tree", width="stretch")
    uploaded_metadata = st.file_uploader("Metadata CSV (optional)", type=["csv"])

try:
    newick_text, tree_source = read_uploaded_or_default(uploaded_tree)
    tree = parse_newick(newick_text)
except (ValueError, UnicodeDecodeError) as exc:
    st.error(str(exc))
    st.stop()

tips = tip_labels(tree)
peartree_newick = tree_to_newick(tree)
tree_bytes = uploaded_tree.getvalue() if uploaded_tree is not None else DEFAULT_TREE.read_bytes()

tree_identity = (tree_source, peartree_newick)
if st.session_state.get("tree_identity") != tree_identity:
    st.session_state.tree_identity = tree_identity
    st.session_state.selected_tip_names = [tips[0]]
    st.session_state.tree_is_cleared = False
    st.session_state.photo_root_input = str(APP_DIR / "sample_photos") if uploaded_tree is None else ""
if clear_current_tree:
    st.session_state.tree_is_cleared = True

tree_is_cleared = st.session_state.get("tree_is_cleared", False)

with st.sidebar:
    st.caption(f"{len(tips)} tips · {tree_source}")
    st.divider()
    st.header("Photo folders")
    photo_root_text = st.text_input(
        "Folder containing node photo folders",
        key="photo_root_input",
        placeholder="Choose or enter a local folder",
    )
    st.button("Choose folder…", on_click=choose_photo_root, width="stretch")
    if st.session_state.get("folder_picker_error"):
        st.error(st.session_state.folder_picker_error)
    if st.session_state.get("photo_library_created"):
        st.success(st.session_state.pop("photo_library_created"))

photo_root: Path | None = Path(photo_root_text).expanduser() if photo_root_text.strip() else None
photo_root_is_empty = False
if photo_root is not None and photo_root.exists() and photo_root.is_dir():
    try:
        photo_root_is_empty = folder_is_effectively_empty(photo_root)
    except OSError as exc:
        st.error(f"Could not inspect the selected photo folder: {exc}")

if photo_root_is_empty and photo_root is not None:
    with st.sidebar:
        st.warning("This folder is empty. Set it up for the loaded tree?")
        try:
            folders_to_create = photo_folder_labels(tips)
            st.caption(f"One full-name folder will be created for each of the {len(folders_to_create)} named tree tips.")
            with st.expander("Review folder names"):
                st.dataframe(pd.DataFrame({"folder_name": folders_to_create}), hide_index=True, width="stretch")
            if st.button(
                f"Create {len(folders_to_create)} folders + copy tree",
                type="primary",
                width="stretch",
                disabled=not folders_to_create,
            ):
                count, tree_copy = initialise_photo_library(
                    photo_root,
                    folders_to_create,
                    tree_source,
                    tree_bytes,
                )
                st.session_state.photo_library_created = (
                    f"Created {count} node folders and copied the tree as {tree_copy.name}."
                )
                st.rerun()
        except (ValueError, OSError) as exc:
            st.error(str(exc))

with st.sidebar:
    st.divider()
    st.header("Folder matching")
    rule = st.selectbox("Tip-to-folder key", ["Full tip label", "Leading fields", "Regular expression"])
    delimiter = "_"
    field_count = 1
    regex = ""
    if rule == "Leading fields":
        delimiter = st.text_input("Delimiter", value="_")
        field_count = st.number_input("Number of leading fields", min_value=1, value=1, step=1)
    elif rule == "Regular expression":
        regex = st.text_input("Regex (first capture group is used)", value=r"^([^_]+)")
    match_mode = st.radio("Folder-name comparison", ["Equals key", "Starts with key"])
    case_sensitive = st.checkbox("Case-sensitive matching", value=False)

metadata: pd.DataFrame | None = None
metadata_tip_column: str | None = None
if uploaded_metadata is not None:
    try:
        metadata = pd.read_csv(uploaded_metadata)
        if metadata.empty or not len(metadata.columns):
            st.warning("The metadata CSV is empty.")
            metadata = None
        else:
            with st.sidebar:
                metadata_tip_column = st.selectbox("Metadata tip-label column", list(metadata.columns))
    except Exception as exc:
        st.error(f"Could not read metadata CSV: {exc}")

matches = {}
if photo_root is not None:
    if photo_root.exists() and photo_root.is_dir():
        try:
            matches = match_photo_folders(
                tips,
                photo_root,
                rule,
                delimiter=delimiter,
                field_count=int(field_count),
                pattern=regex,
                starts_with=match_mode == "Starts with key",
                case_sensitive=case_sensitive,
            )
        except (ValueError, OSError) as exc:
            st.error(f"Could not match photo folders: {exc}")

panels_area = st.container()
with panels_area:
    left_panel, right_panel = st.columns([1.2, 1])

with left_panel:
    st.markdown('<div id="phylogeny-tree-panel"></div>', unsafe_allow_html=True)
    if tree_is_cleared:
        selected_tips = []
        st.info("Tree cleared. Upload a Newick tree in the sidebar to load another tree.")
    else:
        selection = peartree_viewer(
            peartree_newick,
            filename=tree_source,
            selected_tips=st.session_state.selected_tip_names,
            key="peartree-tree",
            height=900,
        )
        returned_tips = selection.get("tips", [])
        if isinstance(returned_tips, list):
            selected_tips = list(dict.fromkeys(name for name in returned_tips if name in tips))
            st.session_state.selected_tip_names = selected_tips
        else:
            selected_tips = list(st.session_state.selected_tip_names)

with right_panel:
    st.markdown('<div id="sample-photo-panel"></div>', unsafe_allow_html=True)
    if len(selected_tips) == 1:
        st.markdown(f"**Tip — {selected_tips[0]}**")
    elif selected_tips:
        st.markdown(f"**Selected node — {len(selected_tips)} descendant tips**")
        with st.expander("Descendant tip labels"):
            st.dataframe(pd.DataFrame({"tip": selected_tips}), hide_index=True, width="stretch")
    else:
        st.info("Select a tip or node in PearTree.")

    if selected_tips and metadata is not None and metadata_tip_column is not None:
        selected_metadata = metadata[metadata[metadata_tip_column].astype(str).isin(selected_tips)]
        with st.expander(f"Metadata rows ({len(selected_metadata)})"):
            st.dataframe(selected_metadata, hide_index=True, width="stretch")

    if selected_tips:
        if not matches:
            st.info("Photo matching is not available. Check the photo root and matching settings.")
        else:
            matched_groups = []
            for tip in selected_tips:
                match = matches.get(tip)
                if match is not None and match.folder is not None:
                    matched_groups.append((tip, match.folder, photo_files(match.folder)))
            groups_with_photos = [group for group in matched_groups if group[2]]

            if not groups_with_photos:
                if len(selected_tips) == 1 and matched_groups:
                    st.info(f"No photos yet. Add an image to:\n\n`{matched_groups[0][1]}`")
                elif matched_groups:
                    st.info("The selected descendant folders exist, but they do not contain supported image files yet.")
                else:
                    st.warning("No selected tip has an unambiguous matching photo folder.")

            for tip, folder, files in groups_with_photos:
                st.markdown(f"#### {tip}")
                st.caption(str(folder))
                for image_path in files:
                    st.image(str(image_path), caption=image_path.name, width="stretch")

if not photo_root_text.strip():
    st.info("Enter a photo root folder to check folder matches.")
elif photo_root is None or not photo_root.exists() or not photo_root.is_dir():
    st.error(f"Photo root folder does not exist or is not a directory: {photo_root_text}")
elif matches:
    warning_rows = [
        {
            "tip": match.tip,
            "derived_key": match.key,
            "status": match.status,
            "candidate_folders": ", ".join(match.candidates),
        }
        for match in matches.values()
        if match.status != "matched"
    ]
    with st.expander(f"Folder warnings ({len(warning_rows)})"):
        if warning_rows:
            st.dataframe(pd.DataFrame(warning_rows), hide_index=True, width="stretch")
        else:
            st.success("Every tip has one matching photo folder.")

# Streamlit columns do not include a draggable divider. This local component
# changes only the widths of the two parent columns.
components.html(
    """
    <script>
    (() => {
      const doc = window.parent.document;
      const block = [...doc.querySelectorAll('div[data-testid="stHorizontalBlock"]')]
        .find(element => element.querySelector('#phylogeny-tree-panel'));
      if (!block) return;

      const columns = [...block.children]
        .filter(element => element.matches('div[data-testid="stColumn"]'));
      if (columns.length !== 2) return;
      const [left, right] = columns;
      left.classList.add('phylogeny-left-panel');
      right.classList.add('phylogeny-right-panel');
      left.style.flex = '0 0 56%';
      right.style.flex = '1 1 0';
      left.style.minWidth = '0';
      right.style.minWidth = '0';

      block.querySelector('.phylogeny-splitter')?.remove();
      const splitter = doc.createElement('div');
      splitter.className = 'phylogeny-splitter';
      splitter.title = 'Drag left or right to resize the panels';
      splitter.setAttribute('role', 'separator');
      splitter.setAttribute('aria-orientation', 'vertical');
      splitter.setAttribute('aria-label', 'Resize tree and photo panels');
      block.appendChild(splitter);

      const saved = Number(window.localStorage.getItem('phylogeny-panel-percent'));
      if (saved >= 25 && saved <= 75) left.style.flex = `0 0 ${saved}%`;
      const placeSplitter = () => {
        const blockRect = block.getBoundingClientRect();
        const leftRect = left.getBoundingClientRect();
        splitter.style.left = `${leftRect.right - blockRect.left}px`;
      };
      placeSplitter();
      right.scrollTop = 0;

      let startX = 0;
      let startWidth = 0;
      let blockWidth = 0;
      let dragging = false;
      let shield = null;

      const move = event => {
        if (!dragging) return;
        const pixels = startWidth + event.clientX - startX;
        const percent = Math.min(75, Math.max(25, pixels / blockWidth * 100));
        left.style.flex = `0 0 ${percent}%`;
        placeSplitter();
        splitter.setAttribute('aria-valuenow', Math.round(percent));
      };
      const stop = () => {
        if (!dragging) return;
        dragging = false;
        splitter.classList.remove('is-dragging');
        shield?.remove();
        const percent = left.getBoundingClientRect().width / block.getBoundingClientRect().width * 100;
        window.localStorage.setItem('phylogeny-panel-percent', String(percent));
        window.dispatchEvent(new Event('resize'));
        doc.removeEventListener('pointermove', move);
        doc.removeEventListener('pointerup', stop);
      };
      splitter.addEventListener('pointerdown', event => {
        event.preventDefault();
        dragging = true;
        startX = event.clientX;
        startWidth = left.getBoundingClientRect().width;
        blockWidth = block.getBoundingClientRect().width;
        splitter.classList.add('is-dragging');
        shield = doc.createElement('div');
        shield.className = 'phylogeny-drag-shield';
        block.appendChild(shield);
        shield.addEventListener('pointermove', move);
        shield.addEventListener('pointerup', stop);
        doc.addEventListener('pointermove', move);
        doc.addEventListener('pointerup', stop);
      });
    })();
    </script>
    """,
    height=0,
    scrolling=False,
)
