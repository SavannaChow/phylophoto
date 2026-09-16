# PhyloPhoto browser + NAS sharing

This edition preserves the browser-local workflow from `05ecfe1` and adds optional NAS datasets and share links. PearTree remains isolated in its iframe, and the tree/photo layout, local file controls, rooting, node matching, and visual options are unchanged.

## Two data modes

### Browser-local mode

Use **Open tree** and **Photo folder** exactly as before. The selected local files stay in that browser tab and are never sent to the server.

### NAS dataset mode

Docker reads the NAS data directory directly. The browser downloads only the selected tree, a list of photo filenames, and photos that are actually displayed. It does not copy the photo library into Docker.

Each analysis has a stable dataset ID. Selecting a NAS dataset enables the link button. A link such as the following automatically loads the same tree and photo library for anyone who can reach that Synology service:

```text
http://SYNOLOGY_IP:8502/?dataset=analysis-2026-a
```

## NAS directory layout

Each named folder is one analysis. Put its tree and folders named exactly like its tree tips directly together; no `datasets/` or `photos/` folder is needed:

```text
/volume1/R204公用/Phylophoto/
└── Ahyacinthus/
    ├── analysis.tree
    ├── Full_tip_label_A/
    │   ├── photo1.jpg
    │   └── photo2.jpg
    └── Full_tip_label_B/
        └── photo1.jpg
```

The simplest layout needs no configuration file when the analysis folder has exactly one tree file. For an explicit title, metadata, or a non-standard photo location, add `dataset.json` inside the analysis directory:

```json
{
  "title": "Acropora analysis 2026 A",
  "tree": "analysis.tree",
  "photos": "photos",
  "metadata": "metadata.csv"
}
```

Paths are relative to the analysis directory and must remain inside the mounted data root. Existing `datasets/<analysis>/photos/` layouts remain readable for compatibility.

## Optional browser upload

Each named analysis folder is one dataset: it contains that analysis's tree and folders named after its tree tips. There is no extra category hierarchy. Large photo libraries can be copied directly into the NAS shared folder, or uploaded through the browser.

Create `client/.env` on the NAS:

```dotenv
PHYLOPHOTO_DATA_PATH=/volume1/docker/phylophoto/data
```

The collapsed **Upload dataset to NAS** panel writes directly into this same shared folder. Choose **New folder**, enter its **Folder name**, choose its tree and photo folder, then upload. To add photos later, choose that existing NAS folder in **Upload to NAS folder**, choose only a photo folder, and upload. Existing files with the same path are replaced.

Uploads are streamed one file at a time with three concurrent transfers. They are practical on the local network, but directly placing very large libraries on the NAS remains faster and more reliable.

## Synology Docker

From the repository's client directory on the NAS:

```bash
cd /volume1/docker/phylophoto/client
docker compose up -d --build
docker compose logs --tail=50 phylophoto-client
```

Open `http://SYNOLOGY_IP:8502`.

The service is stateless for viewers: multiple tabs and multiple people can view different datasets simultaneously. Browser-local trees and folders remain private to each tab. A shared NAS link is reachable only by people who can access the NAS through the same LAN, VPN/Tailscale, or a separately configured HTTPS reverse proxy.

## Security boundaries

- The configured NAS data mount is writable so browser uploads can create folders and add photos directly in the shared library.
- Dataset IDs and file paths are validated against path traversal.
- This deployment has no login: anyone who can reach the NAS service can view datasets and upload a dataset. Keep it inside a trusted LAN/VPN or protect it with your reverse proxy/firewall.
- PearTree visual settings remain browser-local and are not included in shared dataset links.
