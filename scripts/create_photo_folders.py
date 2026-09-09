#!/usr/bin/env python3
"""Create one photo folder per matching Newick tip, using its full label."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from Bio import Phylo


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tree", type=Path, help="Newick tree file")
    parser.add_argument("photo_root", type=Path, help="Folder under which sample folders are created")
    parser.add_argument(
        "--tip-regex",
        default="",
        help="Optional regex used to filter tip labels (default: create a folder for every named tip)",
    )
    args = parser.parse_args()

    tree = Phylo.read(args.tree, "newick")
    pattern = re.compile(args.tip_regex) if args.tip_regex else None
    names = [tip.name for tip in tree.get_terminals() if tip.name and (pattern is None or pattern.search(tip.name))]
    if len(names) != len(set(names)):
        raise SystemExit("Matching tip labels are not unique; no folders were created.")

    args.photo_root.mkdir(parents=True, exist_ok=True)
    for name in names:
        if Path(name).name != name or name in {".", ".."}:
            raise SystemExit(f"Unsafe tip label cannot be used as a folder name: {name!r}")
        (args.photo_root / name).mkdir(exist_ok=True)

    print(f"Created or retained {len(names)} folders under {args.photo_root.resolve()}")


if __name__ == "__main__":
    main()
