"""Local Streamlit phylogeny and sample-photo browser using PearTree."""

from __future__ import annotations

import html
import os
from pathlib import Path
import subprocess
import sys

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from peartree_component import peartree_viewer
from tree_utils import (
    create_missing_photo_folders,
    equalise_branch_lengths,
    load_photo_preferences,
    match_photo_folders,
    missing_photo_folder_labels,
    parse_tree_text,
    photo_files,
    photo_folder_labels,
    proportionalise_branch_lengths,
    save_photo_preferences,
    tip_labels,
    tree_to_newick,
)


APP_DIR = Path(__file__).resolve().parent
ROOTING_MODES = ["Original root", "Single outgroup", "Multiple outgroups (MRCA)", "Midpoint root"]
DEFAULT_PHOTO_ROOT = os.environ.get("PHYLOPHOTO_ROOT", "")


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
    .phylogeny-title {
        display: flex;
        align-items: baseline;
        gap: .65rem;
        min-width: 0;
        margin: -.65rem 0 .35rem;
        font-size: 1.5rem;
        line-height: 1.15;
        font-weight: 700;
    }
    .phylogeny-title span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(128, 128, 128, .78);
        font-size: .85rem;
        font-weight: 400;
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
def clear_workspace() -> None:
    """Clear the paired tree/photo workspace without touching disk files."""
    st.session_state.tree_upload_generation = int(st.session_state.get("tree_upload_generation", 0)) + 1
    st.session_state.tree_identity = None
    st.session_state.tree_is_cleared = True
    st.session_state.selected_tip_names = []
    st.session_state.photo_root_input = ""
    st.session_state.preference_root_key = ""
    st.session_state.loaded_photo_preferences = {}
    st.session_state.peartree_root_request = {}


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
    tree_upload_generation = int(st.session_state.get("tree_upload_generation", 0))
    uploaded_tree = st.file_uploader(
        "Newick or NEXUS tree",
        type=["nwk", "newick", "tree", "tre", "nex", "nexus"],
        key=f"tree_upload_{tree_upload_generation}",
    )
    st.button("Clear current tree", width="stretch", on_click=clear_workspace)
    uploaded_metadata = st.file_uploader("Metadata CSV (optional)", type=["csv"])

if uploaded_tree is None:
    st.info("Upload a Newick tree to begin.")
    st.stop()

try:
    newick_text = uploaded_tree.getvalue().decode("utf-8-sig")
    tree_source = uploaded_tree.name
    tree = parse_tree_text(newick_text, tree_source)
except (ValueError, UnicodeDecodeError) as exc:
    st.error(str(exc))
    st.stop()

tips = tip_labels(tree)
peartree_newick = tree_to_newick(tree)

tree_identity = (tree_source, peartree_newick)
if st.session_state.get("tree_identity") != tree_identity:
    st.session_state.tree_identity = tree_identity
    st.session_state.selected_tip_names = [tips[0]]
    st.session_state.tree_is_cleared = False
    st.session_state.photo_root_input = DEFAULT_PHOTO_ROOT
    st.session_state.rooting_mode = ROOTING_MODES[0]
    st.session_state.single_outgroup = tips[0]
    st.session_state.multiple_outgroups = []
    st.session_state.applied_rooting_preferences = {"mode": ROOTING_MODES[0], "outgroups": []}
    st.session_state.peartree_root_request = {}

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
    if sys.platform == "darwin":
        st.button("Choose folder…", on_click=choose_photo_root, width="stretch")
    else:
        st.caption("Server photo path (Docker default: /data/photos)")
    if st.session_state.get("folder_picker_error"):
        st.error(st.session_state.folder_picker_error)
    if st.session_state.get("photo_library_created"):
        st.success(st.session_state.pop("photo_library_created"))
    if st.session_state.get("preferences_saved"):
        st.success(st.session_state.pop("preferences_saved"))

photo_root: Path | None = Path(photo_root_text).expanduser() if photo_root_text.strip() else None
preference_root_key = str(photo_root.resolve()) if photo_root is not None and photo_root.is_dir() else ""
if st.session_state.get("preference_root_key") != preference_root_key:
    st.session_state.preference_root_key = preference_root_key
    loaded_preferences: dict[str, object] = {}
    if preference_root_key:
        try:
            loaded_preferences = load_photo_preferences(photo_root)
        except ValueError as exc:
            st.session_state.preference_load_error = str(exc)
    st.session_state.loaded_photo_preferences = loaded_preferences
    folder_preferences = loaded_preferences.get("folder_matching", {})
    if not isinstance(folder_preferences, dict):
        folder_preferences = {}
    saved_rule = folder_preferences.get("rule")
    st.session_state.folder_match_rule = (
        saved_rule if saved_rule in {"Full tip label", "Leading fields", "Regular expression"} else "Full tip label"
    )
    saved_delimiter = folder_preferences.get("delimiter", "_")
    st.session_state.folder_match_delimiter = saved_delimiter if isinstance(saved_delimiter, str) else "_"
    try:
        saved_field_count = max(1, int(folder_preferences.get("field_count", 1)))
    except (TypeError, ValueError):
        saved_field_count = 1
    st.session_state.folder_match_field_count = saved_field_count
    saved_regex = folder_preferences.get("regex", r"^([^_]+)")
    st.session_state.folder_match_regex = saved_regex if isinstance(saved_regex, str) else r"^([^_]+)"
    saved_match_mode = folder_preferences.get("match_mode")
    st.session_state.folder_match_mode = (
        saved_match_mode if saved_match_mode in {"Equals key", "Starts with key"} else "Equals key"
    )
    st.session_state.folder_match_case_sensitive = bool(folder_preferences.get("case_sensitive", False))
    peartree_preferences = loaded_preferences.get("peartree", {})
    st.session_state.peartree_settings = peartree_preferences if isinstance(peartree_preferences, dict) else {}
    tree_display_preferences = loaded_preferences.get("tree_display", {})
    saved_branch_mode = tree_display_preferences.get("branch_lengths") if isinstance(tree_display_preferences, dict) else None
    st.session_state.branch_length_mode = (
        saved_branch_mode if saved_branch_mode in {"Original", "Proportional", "Equal"} else "Original"
    )
    rooting_preferences = loaded_preferences.get("rooting", {})
    if not isinstance(rooting_preferences, dict):
        rooting_preferences = {}
    saved_rooting_mode = rooting_preferences.get("mode")
    saved_outgroups = rooting_preferences.get("outgroups", [])
    valid_outgroups = [name for name in saved_outgroups if isinstance(name, str) and name in tips]
    st.session_state.rooting_mode = saved_rooting_mode if saved_rooting_mode in ROOTING_MODES else ROOTING_MODES[0]
    st.session_state.single_outgroup = valid_outgroups[0] if valid_outgroups else tips[0]
    st.session_state.multiple_outgroups = valid_outgroups
    st.session_state.applied_rooting_preferences = {
        "mode": st.session_state.rooting_mode,
        "outgroups": valid_outgroups,
    }
    if st.session_state.rooting_mode == "Midpoint root" or (
        st.session_state.rooting_mode == "Single outgroup" and len(valid_outgroups) == 1
    ) or (
        st.session_state.rooting_mode == "Multiple outgroups (MRCA)" and len(valid_outgroups) >= 2
    ):
        sequence = int(st.session_state.get("peartree_root_sequence", 0)) + 1
        st.session_state.peartree_root_sequence = sequence
        st.session_state.peartree_root_request = {
            "requestId": sequence,
            "mode": "midpoint" if st.session_state.rooting_mode == "Midpoint root" else "selection",
            "tips": valid_outgroups,
        }

library_preferences = st.session_state.get("loaded_photo_preferences", {})
if not isinstance(library_preferences, dict):
    library_preferences = {}

with st.sidebar:
    if st.session_state.get("preference_load_error"):
        st.warning(st.session_state.pop("preference_load_error"))
    st.divider()
    st.header("Tree display")
    branch_length_mode = st.radio(
        "Branch lengths",
        ["Original", "Proportional", "Equal"],
        horizontal=True,
        key="branch_length_mode",
        help=(
            "Original keeps the loaded branch lengths. Proportional is a FigTree-style topology view "
            "scaled by descendant tip count. Equal gives every edge the same display length."
        ),
    )

if preference_root_key and photo_root is not None:
    with st.sidebar:
        try:
            required_folders = photo_folder_labels(tips)
            missing_folders = missing_photo_folder_labels(photo_root, required_folders)
            if missing_folders:
                st.warning(f"{len(missing_folders)} node photo folder(s) are missing.")
                with st.expander("Review folders to create"):
                    st.dataframe(pd.DataFrame({"folder_name": missing_folders}), hide_index=True, width="stretch")
                if st.button(
                    f"Create {len(missing_folders)} missing photo folders",
                    type="primary",
                    width="stretch",
                ):
                    created = create_missing_photo_folders(photo_root, required_folders)
                    st.session_state.photo_library_created = f"Created {len(created)} node photo folders."
                    st.rerun()
        except (ValueError, OSError) as exc:
            st.error(str(exc))

with st.sidebar:
    st.divider()
    st.header("Folder matching")
    rule = st.selectbox(
        "Tip-to-folder key",
        ["Full tip label", "Leading fields", "Regular expression"],
        key="folder_match_rule",
    )
    delimiter = "_"
    field_count = 1
    regex = ""
    if rule == "Leading fields":
        delimiter = st.text_input("Delimiter", key="folder_match_delimiter")
        field_count = st.number_input(
            "Number of leading fields",
            min_value=1,
            step=1,
            key="folder_match_field_count",
        )
    elif rule == "Regular expression":
        regex = st.text_input("Regex (first capture group is used)", key="folder_match_regex")
    match_mode = st.radio(
        "Folder-name comparison",
        ["Equals key", "Starts with key"],
        key="folder_match_mode",
    )
    case_sensitive = st.checkbox("Case-sensitive matching", key="folder_match_case_sensitive")
    save_preferences_requested = st.button(
        "Save visual options",
        width="stretch",
        disabled=not preference_root_key,
    )

if save_preferences_requested:
    sequence = int(st.session_state.get("settings_save_sequence", 0)) + 1
    st.session_state.settings_save_sequence = sequence
    st.session_state.settings_save_request = sequence

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

viewer_tree_text = peartree_newick
viewer_tree_filename = tree_source
current_tree_label = viewer_tree_filename
if branch_length_mode != "Original":
    try:
        display_tree = parse_tree_text(viewer_tree_text, viewer_tree_filename)
        if branch_length_mode == "Equal":
            display_tree = equalise_branch_lengths(display_tree)
        else:
            display_tree = proportionalise_branch_lengths(display_tree)
        viewer_tree_text = tree_to_newick(display_tree)
        viewer_tree_filename = f"{Path(viewer_tree_filename).stem}.{branch_length_mode.lower()}.nwk"
    except ValueError as exc:
        st.error(f"Could not transform branch lengths: {exc}")

st.markdown(
    '<div class="phylogeny-title">Phylogeny photo browser'
    f'<span>{html.escape(current_tree_label)}</span></div>',
    unsafe_allow_html=True,
)

panels_area = st.container()
with panels_area:
    left_panel, right_panel = st.columns([1.2, 1])

settings_snapshot_result: dict[str, object] | None = None
root_apply_result: dict[str, object] | None = None
with left_panel:
    st.markdown('<div id="phylogeny-tree-panel"></div>', unsafe_allow_html=True)
    if tree_is_cleared:
        selected_tips = []
        st.info("Tree cleared. Upload a Newick tree in the sidebar to load another tree.")
    else:
        selection = peartree_viewer(
            viewer_tree_text,
            filename=viewer_tree_filename,
            selected_tips=st.session_state.selected_tip_names,
            settings=st.session_state.get("peartree_settings", {}),
            settings_save_request=int(st.session_state.get("settings_save_request", 0)),
            root_request=st.session_state.get("peartree_root_request", {}),
            key=f"peartree-tree-{int(st.session_state.get('tree_reset_sequence', 0))}",
            height=900,
        )
        returned_tips = selection.get("tips", [])
        if isinstance(returned_tips, list):
            selected_tips = list(dict.fromkeys(name for name in returned_tips if name in tips))
            st.session_state.selected_tip_names = selected_tips
        else:
            selected_tips = list(st.session_state.selected_tip_names)
        returned_settings = selection.get("settings", {})
        if isinstance(returned_settings, dict):
            st.session_state.peartree_settings = returned_settings
        returned_snapshot = selection.get("settingsSnapshot")
        if isinstance(returned_snapshot, dict):
            settings_snapshot_result = returned_snapshot
        returned_root = selection.get("rootApplied")
        if isinstance(returned_root, dict):
            root_apply_result = returned_root

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

if root_apply_result is not None:
    request_id = int(root_apply_result.get("requestId", 0) or 0)
    if request_id and request_id != st.session_state.get("processed_peartree_root_request"):
        st.session_state.processed_peartree_root_request = request_id
        if root_apply_result.get("error"):
            st.session_state.rooting_apply_error = str(root_apply_result["error"])
        else:
            pending = st.session_state.get("pending_rooting_preferences", {})
            if isinstance(pending, dict):
                st.session_state.applied_rooting_preferences = pending
            st.session_state.rooting_apply_message = "PearTree applied the selected root."

with st.expander("Rooting / outgroup", expanded=False):
    rooting_mode = st.selectbox("Rooting mode", ROOTING_MODES, key="rooting_mode")
    requested_outgroups: list[str] = []
    if rooting_mode == "Single outgroup":
        requested_outgroups = [st.selectbox("Outgroup tip — type to search", tips, key="single_outgroup")]
    elif rooting_mode == "Multiple outgroups (MRCA)":
        requested_outgroups = st.multiselect("Outgroup tips — type to search", tips, key="multiple_outgroups")
        if len(requested_outgroups) >= 2:
            topology_tips = {tip.name: tip for tip in tree.get_terminals()}
            mrca = tree.common_ancestor(*(topology_tips[name] for name in requested_outgroups))
            unexpected = [tip.name for tip in mrca.get_terminals() if tip.name not in requested_outgroups]
            if unexpected:
                st.warning(f"Their MRCA also contains {len(unexpected)} unselected descendant tip(s).")
                st.dataframe(pd.DataFrame({"additional_MRCA_tip": unexpected}), hide_index=True, width="stretch")
            else:
                st.caption("The selected outgroups are monophyletic in the loaded topology.")

    disabled = rooting_mode == "Multiple outgroups (MRCA)" and len(requested_outgroups) < 2
    if st.button("Apply root in PearTree", disabled=disabled):
        if rooting_mode == "Original root":
            st.session_state.peartree_root_request = {}
            st.session_state.applied_rooting_preferences = {"mode": rooting_mode, "outgroups": []}
            st.session_state.tree_reset_sequence = int(st.session_state.get("tree_reset_sequence", 0)) + 1
            st.session_state.rooting_apply_message = "Restored the originally uploaded root."
            st.rerun()
        sequence = int(st.session_state.get("peartree_root_sequence", 0)) + 1
        st.session_state.peartree_root_sequence = sequence
        st.session_state.peartree_root_request = {
            "requestId": sequence,
            "mode": "midpoint" if rooting_mode == "Midpoint root" else "selection",
            "tips": requested_outgroups,
        }
        st.session_state.pending_rooting_preferences = {"mode": rooting_mode, "outgroups": requested_outgroups}
        st.rerun()

    if st.session_state.get("rooting_apply_error"):
        st.error(st.session_state.pop("rooting_apply_error"))
    if st.session_state.get("rooting_apply_message"):
        st.success(st.session_state.pop("rooting_apply_message"))

def current_preferences() -> dict[str, object]:
    preferences = dict(library_preferences)
    # Older versions stored a PearTree-exported current tree here. Do not
    # preserve or restore that state: branch displays must always start from
    # the tree explicitly loaded by the user.
    preferences.pop("tree_state", None)
    preferences.update({
        "version": 1,
        "folder_matching": {
            "rule": rule,
            "delimiter": st.session_state.get("folder_match_delimiter", "_"),
            "field_count": int(st.session_state.get("folder_match_field_count", 1)),
            "regex": st.session_state.get("folder_match_regex", r"^([^_]+)"),
            "match_mode": match_mode,
            "case_sensitive": case_sensitive,
        },
        "peartree": st.session_state.get("peartree_settings", {}),
        "tree_display": {"branch_lengths": branch_length_mode},
        "rooting": st.session_state.get("applied_rooting_preferences", {"mode": "Original root", "outgroups": []}),
    })
    return preferences


if settings_snapshot_result is not None and photo_root is not None:
    request_id = int(settings_snapshot_result.get("requestId", 0) or 0)
    if request_id and request_id != st.session_state.get("processed_settings_save_request"):
        st.session_state.processed_settings_save_request = request_id
        st.session_state.settings_save_request = 0
        snapshot = settings_snapshot_result.get("settings")
        if not isinstance(snapshot, dict):
            snapshot = {}
        st.session_state.peartree_settings = snapshot
        try:
            preferences = current_preferences()
            saved_preferences_path = save_photo_preferences(photo_root, preferences)
            st.session_state.loaded_photo_preferences = preferences
            st.session_state.preferences_saved = (
                f"Saved {len(snapshot)} PearTree visual settings to {saved_preferences_path.name}."
            )
            st.rerun()
        except ValueError as exc:
            with st.sidebar:
                st.error(str(exc))

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
