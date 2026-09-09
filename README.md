# Phylogeny photo browser

A small, local-only Streamlit app for browsing a Newick phylogeny and the sample photos associated with its tips.

## Features

- Parses Newick trees and extracts all uniquely named tips.
- Keeps the original root, roots on one tip, roots on the MRCA of several tips, or midpoint-roots the tree.
- Reports every descendant included when a selected multi-tip outgroup is not monophyletic.
- Displays a rooted rectangular phylogram with clickable tips and internal nodes, plus a searchable selector fallback.
- Keeps rooting and display settings after a browser refresh.
- Uses independently scrollable tree/photo panels with a draggable center divider.
- Matches tip-derived prefixes to photo folders and shows all supported images recursively.
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

The included `.tree` file loads automatically when no tree is uploaded. The photo root defaults to the included `sample_photos` folder. The app only reads local files and Streamlit binds to the local machine by default.

For the included tree, `sample_photos` has one folder for each tip whose full label begins with `S` followed by a number. To regenerate those folders for another tree:

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

Upload a CSV and choose the column containing the exact tree tip labels. When a tip or internal node is selected, matching metadata rows appear above the photos.

## Test

```bash
pytest -q
```
