"""Tree parsing, rooting, serialisation, and photo-matching helpers."""

from __future__ import annotations

import copy
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from Bio import Phylo
from Bio.Phylo.BaseTree import Clade, Tree


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".bmp"}
PREFERENCES_FILENAME = "phylogeny_photo_preferences.json"


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


def parse_tree_text(text: str, filename: str) -> Tree:
    """Parse one Newick or NEXUS tree using the filename as a format hint."""
    suffix = Path(filename).suffix.lower()
    if suffix in {".nex", ".nexus"}:
        try:
            tree = Phylo.read(io.StringIO(text), "nexus")
        except Exception as exc:
            raise ValueError(f"Could not parse the saved NEXUS tree: {exc}") from exc
        names = [tip.name for tip in tree.get_terminals()]
        if not names or any(not name for name in names):
            raise ValueError("The saved NEXUS tree has missing tip labels.")
        if len(names) != len(set(names)):
            raise ValueError("The saved NEXUS tree has duplicate tip labels.")
        return tree
    return parse_newick(text)


def tip_labels(tree: Tree) -> list[str]:
    return [tip.name for tip in tree.get_terminals()]


def tree_to_newick(tree: Tree) -> str:
    """Serialise a parsed tree for the local PearTree component."""
    output = io.StringIO()
    Phylo.write(tree, output, "newick")
    return output.getvalue().strip()


def equalise_branch_lengths(tree: Tree, length: float = 1.0) -> Tree:
    """Return a copy whose non-root edges all have the same display length."""
    equalised = copy.deepcopy(tree)
    equalised.root.branch_length = 0.0
    for clade in equalised.find_clades(order="level"):
        if clade is not equalised.root:
            clade.branch_length = length
    return equalised


def proportionalise_branch_lengths(tree: Tree) -> Tree:
    """Return a FigTree-style topology view scaled by descendant tip counts."""
    transformed = copy.deepcopy(tree)
    heights: dict[int, float] = {}
    for clade in transformed.find_clades(order="postorder"):
        heights[id(clade)] = float(len(clade.get_terminals()) - 1)
    transformed.root.branch_length = 0.0
    for parent in transformed.find_clades(order="level"):
        for child in parent.clades:
            child.branch_length = heights[id(parent)] - heights[id(child)]
    return transformed


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


def photo_folder_labels(tips: Iterable[str], pattern: str = "") -> list[str]:
    """Return full tip labels that should become sample-photo folders."""
    try:
        matcher = re.compile(pattern) if pattern else None
    except re.error as exc:
        raise ValueError(f"Invalid folder-creation regex: {exc}") from exc

    labels = [tip for tip in tips if matcher is None or matcher.search(tip)]
    unsafe = [label for label in labels if Path(label).name != label or label in {"", ".", ".."} or "\x00" in label]
    if unsafe:
        raise ValueError("These tip labels cannot safely be folder names: " + ", ".join(unsafe))
    return labels


def missing_photo_folder_labels(photo_root: Path, folder_names: Iterable[str]) -> list[str]:
    """Return full-name photo folders not already present in a photo root."""
    if not photo_root.exists() or not photo_root.is_dir():
        raise ValueError("The selected photo root does not exist or is not a directory.")

    names = list(dict.fromkeys(folder_names))
    if not names:
        raise ValueError("No tip labels match the folder-creation rule.")
    photo_folder_labels(names, pattern="")
    casefolded = [name.casefold() for name in names]
    if len(casefolded) != len(set(casefolded)):
        raise ValueError("Some tip labels collide on a case-insensitive filesystem.")

    entries = {path.name.casefold(): path for path in photo_root.iterdir()}
    conflicts = [name for name in names if name.casefold() in entries and not entries[name.casefold()].is_dir()]
    if conflicts:
        raise ValueError("Files conflict with these required photo-folder names: " + ", ".join(conflicts))
    return [name for name in names if name.casefold() not in entries]


def create_missing_photo_folders(photo_root: Path, folder_names: Iterable[str]) -> list[Path]:
    """Create only missing full-name photo folders; never copy or modify a tree."""
    missing = missing_photo_folder_labels(photo_root, folder_names)

    created_folders: list[Path] = []
    try:
        for name in missing:
            folder = photo_root / name
            folder.mkdir()
            created_folders.append(folder)
    except OSError:
        for folder in reversed(created_folders):
            folder.rmdir()
        raise
    return created_folders


def load_photo_preferences(photo_root: Path) -> dict[str, object]:
    """Load this photo library's saved browser preferences, if present."""
    preferences_path = photo_root / PREFERENCES_FILENAME
    if not preferences_path.exists():
        return {}
    try:
        value = json.loads(preferences_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read {PREFERENCES_FILENAME}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{PREFERENCES_FILENAME} must contain a JSON object.")
    return value


def save_photo_preferences(photo_root: Path, preferences: dict[str, object]) -> Path:
    """Atomically save browser preferences inside a photo library folder."""
    if not photo_root.exists() or not photo_root.is_dir():
        raise ValueError("The selected photo root does not exist or is not a directory.")
    preferences_path = photo_root / PREFERENCES_FILENAME
    temporary_path = photo_root / f".{PREFERENCES_FILENAME}.tmp"
    try:
        temporary_path.write_text(
            json.dumps(preferences, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary_path.replace(preferences_path)
    except (OSError, TypeError, ValueError) as exc:
        if temporary_path.exists():
            temporary_path.unlink()
        raise ValueError(f"Could not save {PREFERENCES_FILENAME}: {exc}") from exc
    return preferences_path


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
