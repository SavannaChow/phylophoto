"""Tree parsing, rooting, matching, and plotting helpers."""

from __future__ import annotations

import copy
import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from Bio import Phylo
from Bio.Phylo.BaseTree import Clade, Tree
import plotly.graph_objects as go


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".bmp"}


@dataclass(frozen=True)
class RootingReport:
    mode: str
    selected_outgroups: tuple[str, ...] = ()
    mrca_descendants: tuple[str, ...] = ()
    is_monophyletic: bool | None = None


@dataclass(frozen=True)
class FolderMatch:
    tip: str
    key: str
    folder: Path | None
    status: str
    candidates: tuple[str, ...] = ()


def parse_newick(text: str) -> Tree:
    """Parse one Newick tree and reject empty or unnamed-tip input."""
    text = text.strip()
    if not text:
        raise ValueError("The Newick file is empty.")
    try:
        tree = Phylo.read(io.StringIO(text), "newick")
    except Exception as exc:
        raise ValueError(f"Could not parse the Newick tree: {exc}") from exc

    tips = tree.get_terminals()
    if not tips:
        raise ValueError("The tree has no tips.")
    unnamed = [index + 1 for index, tip in enumerate(tips) if not tip.name]
    if unnamed:
        raise ValueError(f"Every tip must have a label. Unnamed tip positions: {unnamed}")
    duplicates = sorted({tip.name for tip in tips if sum(t.name == tip.name for t in tips) > 1})
    if duplicates:
        raise ValueError("Tip labels must be unique. Duplicates: " + ", ".join(duplicates))
    return tree


def tip_labels(tree: Tree) -> list[str]:
    return [tip.name for tip in tree.get_terminals()]


def _tips_by_name(tree: Tree) -> dict[str, Clade]:
    return {tip.name: tip for tip in tree.get_terminals()}


def root_tree(tree: Tree, mode: str, outgroups: Iterable[str] = ()) -> tuple[Tree, RootingReport]:
    """Return a rooted copy and a report about the requested rooting operation."""
    rooted = copy.deepcopy(tree)
    names = tuple(dict.fromkeys(outgroups))
    tips = _tips_by_name(rooted)
    missing = [name for name in names if name not in tips]
    if missing:
        raise ValueError("Outgroup tip(s) not found in the tree: " + ", ".join(missing))

    if mode == "Keep original root":
        rooted.rooted = True
        return rooted, RootingReport(mode=mode)
    if mode == "Single outgroup tip":
        if len(names) != 1:
            raise ValueError("Choose exactly one outgroup tip.")
        rooted.root_with_outgroup(tips[names[0]])
        rooted.rooted = True
        return rooted, RootingReport(mode=mode, selected_outgroups=names)
    if mode == "Multiple outgroup tips (MRCA)":
        if len(names) < 2:
            raise ValueError("Choose at least two outgroup tips.")
        mrca = rooted.common_ancestor(*(tips[name] for name in names))
        descendants = tuple(tip.name for tip in mrca.get_terminals())
        monophyletic = set(descendants) == set(names)
        rooted.root_with_outgroup(mrca)
        rooted.rooted = True
        return rooted, RootingReport(
            mode=mode,
            selected_outgroups=names,
            mrca_descendants=descendants,
            is_monophyletic=monophyletic,
        )
    if mode == "Midpoint root":
        rooted.root_at_midpoint()
        rooted.rooted = True
        return rooted, RootingReport(mode=mode)
    raise ValueError(f"Unknown rooting mode: {mode}")


def prefix_key(tip: str, rule: str, delimiter: str = "_", field_count: int = 1, pattern: str = "") -> str:
    if rule == "Full tip label":
        return tip
    if rule == "Leading fields":
        if not delimiter:
            raise ValueError("The delimiter cannot be empty.")
        return delimiter.join(tip.split(delimiter)[:field_count])
    if rule == "Regular expression":
        if not pattern:
            raise ValueError("Enter a regular expression.")
        match = re.search(pattern, tip)
        if not match:
            return ""
        return match.group(1) if match.lastindex else match.group(0)
    raise ValueError(f"Unknown prefix rule: {rule}")


def match_photo_folders(
    tips: Iterable[str],
    photo_root: Path,
    rule: str,
    delimiter: str = "_",
    field_count: int = 1,
    pattern: str = "",
    starts_with: bool = True,
    case_sensitive: bool = False,
) -> dict[str, FolderMatch]:
    """Match tip-derived keys against direct child folders of photo_root."""
    folders = sorted((path for path in photo_root.iterdir() if path.is_dir()), key=lambda p: p.name.lower())
    results: dict[str, FolderMatch] = {}
    for tip in tips:
        key = prefix_key(tip, rule, delimiter, field_count, pattern)
        comparison_key = key if case_sensitive else key.casefold()
        candidates = []
        if key:
            for folder in folders:
                folder_name = folder.name if case_sensitive else folder.name.casefold()
                matched = folder_name.startswith(comparison_key) if starts_with else folder_name == comparison_key
                if matched:
                    candidates.append(folder)
        if len(candidates) == 1:
            results[tip] = FolderMatch(tip, key, candidates[0], "matched", (candidates[0].name,))
        elif len(candidates) > 1:
            results[tip] = FolderMatch(tip, key, None, "ambiguous", tuple(path.name for path in candidates))
        else:
            results[tip] = FolderMatch(tip, key, None, "missing")
    return results


def photo_files(folder: Path) -> list[Path]:
    return sorted(
        (path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() in PHOTO_EXTENSIONS),
        key=lambda path: str(path).lower(),
    )


def assign_node_ids(tree: Tree) -> tuple[dict[str, Clade], dict[int, str]]:
    by_id: dict[str, Clade] = {}
    id_by_object: dict[int, str] = {}
    for index, clade in enumerate(tree.find_clades(order="preorder")):
        node_id = f"node-{index}"
        by_id[node_id] = clade
        id_by_object[id(clade)] = node_id
    return by_id, id_by_object


def descendant_tip_names(clade: Clade) -> list[str]:
    return [tip.name for tip in clade.get_terminals()]


def bootstrap_value(clade: Clade) -> str:
    value = clade.confidence
    if value is None and clade.name is not None and re.fullmatch(r"\d+(?:\.\d+)?", str(clade.name)):
        value = clade.name
    if value is None:
        return ""
    number = float(value)
    return str(int(number)) if number.is_integer() else f"{number:g}"


def node_display_name(node_id: str, clade: Clade) -> str:
    if clade.is_terminal():
        return f"Tip — {clade.name}"
    support = bootstrap_value(clade)
    label = f" — bootstrap {support}" if support else ""
    return f"Internal node {node_id.removeprefix('node-')}{label} — {len(clade.get_terminals())} tips"


def make_tree_figure(
    tree: Tree,
    selected_node_id: str | None = None,
    proportional: bool = True,
    show_bootstrap: bool = True,
    label_font_size: int = 10,
    vertical_expansion: float = 1.0,
    horizontal_zoom: float | None = None,
) -> go.Figure:
    """Build a rectangular rooted phylogram with selectable node markers."""
    nodes, id_by_object = assign_node_ids(tree)
    depths = tree.depths() if proportional else tree.depths(unit_branch_lengths=True)
    if proportional and not any(depths.values()):
        depths = tree.depths(unit_branch_lengths=True)

    terminals = tree.get_terminals()
    y: dict[Clade, float] = {tip: float(len(terminals) - index - 1) for index, tip in enumerate(terminals)}

    def set_internal_y(clade: Clade) -> float:
        if clade in y:
            return y[clade]
        child_values = [set_internal_y(child) for child in clade.clades]
        y[clade] = sum(child_values) / len(child_values)
        return y[clade]

    set_internal_y(tree.root)
    edge_x: list[float | None] = []
    edge_y: list[float | None] = []
    for parent in tree.find_clades(order="preorder"):
        for child in parent.clades:
            edge_x.extend([depths[parent], depths[child], None])
            edge_y.extend([y[child], y[child], None])
        if parent.clades:
            child_ys = [y[child] for child in parent.clades]
            edge_x.extend([depths[parent], depths[parent], None])
            edge_y.extend([min(child_ys), max(child_ys), None])

    figure = go.Figure()
    figure.add_trace(go.Scatter(x=edge_x, y=edge_y, mode="lines", line={"color": "#64748b", "width": 1}, hoverinfo="skip"))

    node_ids = list(nodes)
    clades = [nodes[node_id] for node_id in node_ids]
    hover_labels = [clade.name if clade.is_terminal() else node_display_name(node_id, clade) for node_id, clade in zip(node_ids, clades)]
    visible_labels = [
        clade.name if clade.is_terminal() else (bootstrap_value(clade) if show_bootstrap else "")
        for clade in clades
    ]
    colors = ["#dc2626" if node_id == selected_node_id else ("#0f766e" if clade.is_terminal() else "#2563eb") for node_id, clade in zip(node_ids, clades)]
    sizes = [11 if node_id == selected_node_id else (7 if clade.is_terminal() else 9) for node_id, clade in zip(node_ids, clades)]
    symbols = ["circle" if clade.is_terminal() else "diamond" for clade in clades]
    customdata = [[node_id, "tip" if clade.is_terminal() else "internal"] for node_id, clade in zip(node_ids, clades)]
    figure.add_trace(
        go.Scatter(
            x=[depths[clade] for clade in clades],
            y=[y[clade] for clade in clades],
            mode="markers+text",
            marker={"color": colors, "size": sizes, "symbol": symbols, "line": {"color": "white", "width": 0.7}},
            text=visible_labels,
            textposition="middle right",
            textfont={"size": label_font_size, "color": "#334155"},
            customdata=customdata,
            hovertext=hover_labels,
            hovertemplate="%{hovertext}<extra></extra>",
            name="Nodes",
        )
    )
    xaxis = {
        "title": "Branch length from root" if proportional else "Nodes from root",
        "showgrid": False,
        "zeroline": False,
    }
    if horizontal_zoom is not None:
        maximum_depth = max(depths.values(), default=1.0) or 1.0
        # Leave label room at 1x; higher values magnify the horizontal tree.
        xaxis["range"] = [0, maximum_depth * 1.5 / horizontal_zoom]

    figure.update_layout(
        # Expansion changes only the vertical pixel spacing between nodes. It is
        # deliberately independent from Plotly zoom and horizontal branch scale.
        height=max(600, round(23 * vertical_expansion * len(terminals))),
        margin={"l": 12, "r": 12, "t": 10, "b": 35},
        showlegend=False,
        clickmode="event+select",
        dragmode="pan",
        xaxis=xaxis,
        yaxis={"visible": False, "range": [-1, len(terminals)]},
        plot_bgcolor="white",
    )
    return figure
