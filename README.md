# Phylogeny photo browser

A small, local-only Streamlit app for browsing a Newick phylogeny and the sample photos associated with its tips. This branch embeds the official PearTree viewer locally.

## Features

- Parses Newick trees and extracts all uniquely named tips.
- Uses PearTree's native tree display, visual-options palette, search, zoom, fit, ordering, rotation, subtree, colour, filtering, and bootstrap controls.
- Uses PearTree's native reroot, midpoint-root, and temporal-root tools instead of a second set of Streamlit tree controls.
- Clicking a PearTree tip or internal node sends its selected/descendant tip names to the photo panel.
- Provides a local **Clear current tree** control; upload a Newick file to load the next tree.
- Lets you choose any local photo root with a macOS folder picker, previews missing full-name folders for the loaded tree tips, and creates only those missing folders after confirmation. Tree files are never copied or moved.
- Uses an independently scrollable photo panel and a draggable center divider.
- Matches tip-derived prefixes to photo folders and shows all supported images recursively.
- Can save PearTree display options and folder-matching choices as `phylogeny_photo_preferences.json` inside the selected photo root, then reload them automatically next time that folder is chosen.
- Offers `Original`, FigTree-style `Proportional`, and `Equal` branch-length views without changing tip labels or photo matching.
- Shows missing and ambiguous folder matches in a warning table.
- Optionally displays CSV metadata rows for the selected tip(s).

## Run locally

Python 3.10–3.13 is recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
streamlit run app.py
```

Upload a tree explicitly before choosing its photo root. Reloading the browser clears both inputs because browsers do not retain local file uploads; the app does not silently substitute another tree. PearTree v1.3.1 is vendored under `peartree_component/`, so the tree and photos stay on the local machine and do not require a CDN.

To generate one full-name photo folder for every named tip in another tree:

```bash
python scripts/create_photo_folders.py my_tree.tree sample_photos
```

## Expected photo layout

The default “Full tip label” and “Equals key” settings directly match the pre-created folder names. Alternatively, with the “Leading fields” rule, delimiter `_`, and one leading field, a tip named `B183_Acropora_typeD` produces the key `B183`. In “Starts with key” mode, it matches a direct child folder such as:

```text
photos/
├── B183_field_photos/
│   ├── colony.jpg
│   └── corallite.png
└── B200_field_photos/
    └── colony.jpg
```

If more than one child folder starts with the same key, the match is deliberately marked ambiguous. Change the prefix rule, field count, regex, or comparison mode in the sidebar to resolve it.

Supported image extensions are JPG/JPEG, PNG, GIF, WebP, TIFF, and BMP. Image discovery is recursive within each matched sample folder.

## Metadata CSV

Upload a CSV and choose the column containing the exact tree tip labels. When a tip or internal node is selected in PearTree, matching metadata rows appear above the photos.

## Test

```bash
pytest -q
```
