"""Local Streamlit wrapper for the vendored PearTree viewer."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import streamlit.components.v1 as components


COMPONENT_DIR = Path(__file__).resolve().parent
_peartree_component = components.declare_component(
    "peartree_viewer",
    path=str(COMPONENT_DIR),
)


def peartree_viewer(
    tree: str,
    *,
    filename: str,
    selected_tips: Iterable[str] = (),
    key: str = "peartree-viewer",
    height: int = 700,
) -> dict[str, object]:
    """Render PearTree and return its current selected tip names."""
    names = list(selected_tips)
    value = _peartree_component(
        tree=tree,
        filename=filename,
        selectedTips=names,
        key=key,
        default={"tips": names},
        height=height,
        scrolling=False,
    )
    return value if isinstance(value, dict) else {"tips": names}
