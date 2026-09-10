# PhyloPhoto client-side edition

A static, browser-local edition of Phylogeny photo browser. Its layout mirrors the working local Streamlit/PearTree edition: a compact title bar, full-height tree and photo panels, draggable divider, and collapsed controls below the panels.

## Privacy model

- Synology serves only HTML, JavaScript, CSS, and the vendored PearTree bundle.
- The selected tree and photo folder are read by the browser and are never uploaded or written to the server.
- Photos are displayed from temporary browser object URLs and are released when the selection changes or the tab closes.
- PearTree visual settings are stored in the browser localStorage for this site, not on the server.

## Use

1. Open the site and choose a Newick or NEXUS tree with **Open tree**.
2. Choose the local root folder that contains one direct subfolder per tip with **Photo folder**.
3. Click a PearTree tip or internal node. The right panel displays matching photos vertically.
4. Use PearTree native toolbar/palette for bootstrap labels, zoom, and visual settings. The collapsed controls below the panels also provide searchable tip selection, Original/Proportional/Equal display modes, folder matching, and outgroup or midpoint rooting.

The directory picker is a browser capability. Use a current Chromium browser (Chrome, Edge, or Arc) for the most reliable folder selection. A browser directory selection is read-only, so this edition warns about missing folders but does not create them.

## Synology Docker

From this client directory on the NAS:

```bash
docker compose up -d --build
```

Then open `http://SYNOLOGY_IP:8502`.

The original Streamlit deployment remains at the repository root and port 8501. This client edition is separate and does not need a photo volume mount.
