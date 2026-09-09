"""Local Streamlit wrapper for the vendored PearTree viewer."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Mapping

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
    settings: Mapping[str, object] | None = None,
    key: str = "peartree-viewer",
    height: int = 700,
) -> dict[str, object]:
    """Render PearTree and return its current selected tip names."""
    names = list(selected_tips)
    saved_settings = dict(settings or {})
    value = _peartree_component(
        tree=tree,
        filename=filename,
        selectedTips=names,
        settings=saved_settings,
        key=key,
        default={"tips": names, "settings": saved_settings},
        height=height,
        scrolling=False,
    )
    return value if isinstance(value, dict) else {"tips": names, "settings": saved_settings}
