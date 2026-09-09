"""Local Streamlit phylogeny and sample-photo browser."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from tree_utils import (
    assign_node_ids,
    descendant_tip_names,
    make_tree_figure,
    match_photo_folders,
    node_display_name,
    parse_newick,
    photo_files,
    root_tree,
    tip_labels,
)


APP_DIR = Path(__file__).resolve().parent
DEFAULT_TREE = APP_DIR / "edge-incomplete-min_taxa_050.charsets.renamed_species_accession_geo_srr_gca_species_updated.tree"
ROOTING_MODES = [
    "Keep original root",
    "Single outgroup tip",
    "Multiple outgroup tips (MRCA)",
    "Midpoint root",
]


st.set_page_config(page_title="Phylogeny photo browser", page_icon="🌿", layout="wide")
st.markdown(
    """
    <style>
    /* Streamlit reserves a large page-top gutter by default. */
    [data-testid="stMainBlockContainer"] {
        padding-top: .5rem !important;
        padding-bottom: 1rem !important;
    }
    [data-testid="stHeader"] {
        height: 3rem;
        min-height: 3rem;
        background: transparent;
    }
    [data-testid="stHeading"]:has(h1) {
        margin-top: -1rem;
    }
    [data-testid="stMainBlockContainer"] h1 {
        font-size: 1.5rem !important;
        line-height: 1.15;
        padding-top: .3rem;
        padding-bottom: .25rem;
    }
    </style>
    """,
    unsafe_allow_html=True,
)
st.title("Phylogeny photo browser")
# Reserve the main display area here. Its contents are filled after the tree
# settings have been evaluated, while the controls themselves render below it.
panels_area = st.container()
# Node selection is visually placed before Tree settings, even though its
# options can only be built after the rooted tree has been evaluated.
node_selection_area = st.container()


def read_uploaded_or_default(uploaded_file) -> tuple[str, str]:
    if uploaded_file is not None:
        return uploaded_file.getvalue().decode("utf-8-sig"), uploaded_file.name
    if DEFAULT_TREE.exists():
        return DEFAULT_TREE.read_text(encoding="utf-8-sig"), DEFAULT_TREE.name
    raise ValueError("Upload a Newick tree file.")


def selected_point_node_id(event) -> str | None:
    try:
        points = event.selection.points
    except (AttributeError, KeyError, TypeError):
        try:
            points = event.get("selection", {}).get("points", [])
        except AttributeError:
            return None
    if not points:
        return None
    point = points[-1]
    customdata = point.get("customdata") if isinstance(point, dict) else getattr(point, "customdata", None)
    if isinstance(customdata, (list, tuple)) and customdata:
        return str(customdata[0])
    return None


with st.sidebar:
    st.header("Inputs")
    uploaded_tree = st.file_uploader("Newick tree", type=["nwk", "newick", "tree", "tre"])
    photo_root_text = st.text_input("Photo root folder", value=str(APP_DIR / "sample_photos"))
    uploaded_metadata = st.file_uploader("Metadata CSV (optional)", type=["csv"])

try:
    newick_text, tree_source = read_uploaded_or_default(uploaded_tree)
    original_tree = parse_newick(newick_text)
except (ValueError, UnicodeDecodeError) as exc:
    st.error(str(exc))
    st.stop()

all_tips = tip_labels(original_tree)

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

# Keep tree-display settings in the URL so a normal browser refresh preserves them.
saved_mode = st.query_params.get("rooting", ROOTING_MODES[0])
if saved_mode not in ROOTING_MODES:
    saved_mode = ROOTING_MODES[0]
saved_outgroups = [name for name in st.query_params.get("outgroups", "").split(",") if name in all_tips]
saved_proportional = st.query_params.get("proportional", "1") == "1"
saved_bootstrap = st.query_params.get("bootstrap", "1") == "1"
try:
    saved_font_size = min(24, max(7, int(st.query_params.get("font_size", "10"))))
except ValueError:
    saved_font_size = 10
try:
    saved_expansion = min(4.0, max(0.5, float(st.query_params.get("expansion", "1"))))
except ValueError:
    saved_expansion = 1.0
saved_free_zoom = st.query_params.get("free_zoom", "1") == "1"
try:
    saved_zoom_level = min(4.0, max(0.5, float(st.query_params.get("zoom", "1"))))
except ValueError:
    saved_zoom_level = 1.0

with st.expander(f"Tree settings — {saved_mode}", expanded=False):
    st.caption(f"{len(all_tips)} tips · {tree_source}")
    setting_a, setting_b, setting_c = st.columns([2, 1, 1])
    rooting_mode = setting_a.selectbox(
        "Rooting mode",
        ROOTING_MODES,
        index=ROOTING_MODES.index(saved_mode),
        key="rooting_mode_widget",
    )
    proportional = setting_b.toggle(
        "Proportional branch lengths",
        value=saved_proportional,
        key="proportional_widget",
    )
    show_bootstrap = setting_c.toggle(
        "Show bootstrap",
        value=saved_bootstrap,
        key="bootstrap_widget",
    )
    size_setting, expansion_setting = st.columns(2)
    label_font_size = size_setting.slider(
        "Label font size",
        min_value=7,
        max_value=24,
        value=saved_font_size,
        step=1,
        help="Changes tip labels and bootstrap text.",
    )
    vertical_expansion = expansion_setting.slider(
        "Tree expansion",
        min_value=0.5,
        max_value=4.0,
        value=saved_expansion,
        step=0.1,
        format="%.1f×",
        help="Adds vertical space between nodes without changing branch lengths or zoom.",
    )
    free_zoom = st.toggle(
        "Free zoom",
        value=saved_free_zoom,
        help="Use the mouse wheel or trackpad to zoom freely inside the tree.",
    )
    if free_zoom:
        zoom_level = saved_zoom_level
    else:
        zoom_level = st.slider(
            "Zoom level",
            min_value=0.5,
            max_value=4.0,
            value=saved_zoom_level,
            step=0.1,
            format="%.1f×",
            help="Sets horizontal tree magnification. Vertical spacing is controlled separately by Tree expansion.",
        )

    outgroups: list[str] = []
    if rooting_mode == "Single outgroup tip":
        default_single = saved_outgroups[0] if saved_outgroups else all_tips[0]
        outgroups = [
            st.selectbox(
                "Outgroup tip",
                all_tips,
                index=all_tips.index(default_single),
                key="single_outgroup_widget",
            )
        ]
    elif rooting_mode == "Multiple outgroup tips (MRCA)":
        outgroups = st.multiselect(
            "Outgroup tips",
            all_tips,
            default=saved_outgroups,
            key="multiple_outgroups_widget",
        )

st.query_params["rooting"] = rooting_mode
st.query_params["outgroups"] = ",".join(outgroups)
st.query_params["proportional"] = "1" if proportional else "0"
st.query_params["bootstrap"] = "1" if show_bootstrap else "0"
st.query_params["font_size"] = str(label_font_size)
st.query_params["expansion"] = f"{vertical_expansion:.1f}"
st.query_params["free_zoom"] = "1" if free_zoom else "0"
st.query_params["zoom"] = f"{zoom_level:.1f}"

try:
    rooted_tree, rooting_report = root_tree(original_tree, rooting_mode, outgroups)
except ValueError as exc:
    st.error(str(exc))
    st.stop()

if rooting_report.mode == "Multiple outgroup tips (MRCA)" and rooting_report.mrca_descendants:
    if rooting_report.is_monophyletic:
        st.success("The selected outgroup tips form a monophyletic group.")
    else:
        unexpected = sorted(set(rooting_report.mrca_descendants) - set(rooting_report.selected_outgroups))
        st.warning("The selected outgroups are not monophyletic. Rooting by their MRCA was still applied.")
        with st.expander(f"Review all {len(rooting_report.mrca_descendants)} MRCA descendants", expanded=True):
            st.dataframe(
                pd.DataFrame(
                    {
                        "tip": rooting_report.mrca_descendants,
                        "selected_outgroup": [name in rooting_report.selected_outgroups for name in rooting_report.mrca_descendants],
                        "unexpected_inclusion": [name in unexpected for name in rooting_report.mrca_descendants],
                    }
                ),
                hide_index=True,
                width="stretch",
            )

rooted_tips = tip_labels(rooted_tree)
nodes_by_id, _ = assign_node_ids(rooted_tree)
node_options = list(nodes_by_id)
node_labels = {node_id: node_display_name(node_id, nodes_by_id[node_id]) for node_id in node_options}
root_config = (rooting_mode, tuple(outgroups))
default_node_id = next(node_id for node_id, clade in nodes_by_id.items() if clade.is_terminal())
if (
    st.session_state.get("root_config") != root_config
    or st.session_state.get("selected_node_id") not in nodes_by_id
):
    st.session_state.root_config = root_config
    st.session_state.selected_node_id = default_node_id

with node_selection_area:
    with st.expander(f"Node selection — {node_labels[st.session_state.selected_node_id]}", expanded=False):
        selected_from_list = st.selectbox(
            "Select a tip or internal node",
            node_options,
            index=node_options.index(st.session_state.selected_node_id),
            format_func=lambda node_id: node_labels[node_id],
        )
        if selected_from_list != st.session_state.selected_node_id:
            st.session_state.selected_node_id = selected_from_list
            st.rerun()

matches = {}
photo_root: Path | None = None
if photo_root_text.strip():
    photo_root = Path(photo_root_text).expanduser()
    if photo_root.exists() and photo_root.is_dir():
        try:
            matches = match_photo_folders(
                rooted_tips,
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

st.markdown(
    """
    <style>
    div[data-testid="stHorizontalBlock"]:has(#phylogeny-tree-panel) {
        gap: 0;
        align-items: stretch;
        position: relative;
    }
    div[data-testid="stHorizontalBlock"]:has(#phylogeny-tree-panel) > div[data-testid="stColumn"]:first-child,
    .phylogeny-left-panel {
        flex: 0 0 56%;
        width: auto !important;
        min-width: 360px;
        max-width: calc(75% - 5px);
        height: 78vh;
        min-height: 480px;
        overflow-y: scroll;
        overflow-x: hidden;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        scrollbar-width: auto;
        scrollbar-color: #64748b #e2e8f0;
        border: 1px solid rgba(128, 128, 128, .35);
        border-radius: .55rem;
        padding: 0;
    }
    .phylogeny-left-panel::-webkit-scrollbar {
        width: 12px;
    }
    .phylogeny-left-panel::-webkit-scrollbar-track {
        background: #e2e8f0;
        border-radius: 8px;
    }
    .phylogeny-left-panel::-webkit-scrollbar-thumb {
        background: #64748b;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
    }
    .phylogeny-left-panel::-webkit-scrollbar-thumb:hover {
        background: #475569;
    }
    div[data-testid="stHorizontalBlock"]:has(#phylogeny-tree-panel) > div[data-testid="stColumn"]:last-child,
    .phylogeny-right-panel {
        flex: 1 1 auto;
        width: auto !important;
        min-width: 300px;
        height: 78vh;
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

with panels_area:
    left_panel, right_panel = st.columns([1.2, 1])

with left_panel:
    st.markdown('<div id="phylogeny-tree-panel"></div>', unsafe_allow_html=True)
    figure = make_tree_figure(
        rooted_tree,
        st.session_state.selected_node_id,
        proportional=proportional,
        show_bootstrap=show_bootstrap,
        label_font_size=label_font_size,
        vertical_expansion=vertical_expansion,
        horizontal_zoom=None if free_zoom else zoom_level,
    )
    event = st.plotly_chart(
        figure,
        width="stretch",
        key="tree_plot",
        on_select="rerun",
        selection_mode="points",
        config={
            "scrollZoom": free_zoom,
            "displaylogo": False,
            "displayModeBar": False,
        },
    )
    clicked_node_id = selected_point_node_id(event)
    if clicked_node_id in nodes_by_id and clicked_node_id != st.session_state.selected_node_id:
        st.session_state.selected_node_id = clicked_node_id
        st.rerun()

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

selected_id = st.session_state.selected_node_id
selected_clade = nodes_by_id[selected_id]
selected_tips = descendant_tip_names(selected_clade)

with right_panel:
    st.markdown('<div id="sample-photo-panel"></div>', unsafe_allow_html=True)
    st.markdown(f"**{node_labels[selected_id]}**")
    if not selected_clade.is_terminal():
        st.caption(f"{len(selected_tips)} descendant tips under this node in the rooted tree")
        with st.expander("Descendant tip labels"):
            st.dataframe(pd.DataFrame({"tip": selected_tips}), hide_index=True, width="stretch")

    if metadata is not None and metadata_tip_column is not None:
        selected_metadata = metadata[metadata[metadata_tip_column].astype(str).isin(selected_tips)]
        with st.expander(f"Metadata rows ({len(selected_metadata)})"):
            st.dataframe(selected_metadata, hide_index=True, width="stretch")

    if not matches:
        st.info("Photo matching is not available. Check the photo root and matching settings.")
    else:
        matched_groups = []
        for tip in selected_tips:
            folder = matches[tip].folder
            if folder is not None:
                matched_groups.append((tip, folder, photo_files(folder)))
        groups_with_photos = [group for group in matched_groups if group[2]]
        image_count = sum(len(files) for _, _, files in groups_with_photos)
        if image_count:
            st.caption(f"{image_count} photo(s) across {len(groups_with_photos)} sample folder(s)")

        if not groups_with_photos:
            if selected_clade.is_terminal() and matched_groups:
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

# Streamlit columns do not include a draggable divider. This tiny local component
# adds one to the parent page without sending any data outside the browser.
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

      const savedTreeScroll = Number(window.localStorage.getItem('phylogeny-tree-scroll'));
      if (savedTreeScroll > 0) left.scrollTop = savedTreeScroll;
      if (left.__phylogenyScrollHandler) {
        left.removeEventListener('scroll', left.__phylogenyScrollHandler);
      }
      left.__phylogenyScrollHandler = () => {
        window.localStorage.setItem('phylogeny-tree-scroll', String(left.scrollTop));
      };
      left.addEventListener('scroll', left.__phylogenyScrollHandler, {passive: true});
      right.scrollTop = 0;

      let startX = 0;
      let startWidth = 0;
      let blockWidth = 0;
      let dragging = false;

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
        const percent = left.getBoundingClientRect().width / block.getBoundingClientRect().width * 100;
        window.localStorage.setItem('phylogeny-panel-percent', String(percent));
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
        doc.addEventListener('pointermove', move);
        doc.addEventListener('pointerup', stop);
      });
    })();
    </script>
    """,
    height=0,
    scrolling=False,
)
