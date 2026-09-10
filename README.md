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
- Provides a collapsed bottom rooting panel for the original root, one searchable outgroup, multiple outgroups via their MRCA, or PearTree midpoint rooting.
- Saves a fresh snapshot of all visual settings exposed by PearTree, together with branch-display, rooting, and folder-matching preferences.
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

## Synology Docker deployment

The container is named `phylophoto` and listens on port `8501`. The default Compose file maps the Synology folder
`/volume1/docker/phylophoto/photos` to `/data/photos` inside the container. Edit only the left side of that volume mapping if your NAS folder is elsewhere. The photo library must be writable by Container Manager because the app can create missing tip folders and save `phylogeny_photo_preferences.json`.

### 1. Publish from VS Code to GitHub

Use the GitHub repository `SavannaChow/phylophoto` (do not create a second `UCE-photo` repository). In the VS Code terminal, from this project folder, run:

```bash
git status
git remote add origin https://github.com/SavannaChow/phylophoto.git
git push -u origin peartree
```

If `origin` already exists, replace the second command with:

```bash
git remote set-url origin https://github.com/SavannaChow/phylophoto.git
```

For later updates:

```bash
git push origin peartree
```

VS Code GUI alternative: open **Source Control**, commit any pending changes, open the Command Palette, choose **GitHub: Publish to GitHub**, select the repository visibility, and publish the `peartree` branch. A private repository requires a GitHub SSH key or personal access token when the Synology clones or pulls it; a public repository is simplest for read-only deployment.

### 2. Build on Synology

Enable SSH temporarily in DSM, connect to the NAS, and run (replace the GitHub name and NAS paths as needed):

```bash
mkdir -p /volume1/docker/phylophoto/photos
cd /volume1/docker
git clone --branch peartree https://github.com/SavannaChow/phylophoto.git phylophoto
cd phylophoto
docker compose up -d --build
docker compose ps
```

On older DSM installations where the Compose command is named `docker-compose`, use `docker-compose` in place of `docker compose` in the commands above.

Open:

```text
http://SYNOLOGY_IP:8501
```

In DSM Container Manager you can instead create a **Project** from the checked-out `phylophoto/compose.yaml`. Ensure the project build context contains this repository and the host photo directory exists.

To deploy later GitHub updates:

```bash
cd /volume1/docker/phylophoto
git pull --ff-only origin peartree
docker compose up -d --build
```

Useful commands:

```bash
docker compose logs -f
docker compose restart
docker compose down
```

Keep port `8501` on the trusted LAN or access it through Tailscale. If internet access is required, put it behind Synology Reverse Proxy with HTTPS and access control; Streamlit itself does not add authentication to this app.
