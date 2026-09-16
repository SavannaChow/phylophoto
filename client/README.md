# PhyloPhoto browser + NAS sharing

This edition preserves the browser-local workflow from `05ecfe1` and adds optional NAS datasets and share links. PearTree remains isolated in its iframe, and the tree/photo layout, local file controls, rooting, node matching, and visual options are unchanged.

## Two data modes

### Browser-local mode

Use **Open tree** and **Photo folder** exactly as before. The selected local files stay in that browser tab and are never sent to the server.

### NAS dataset mode

Docker reads an existing NAS data directory through a read-only mount. The browser downloads only the selected tree, a list of photo filenames, and photos that are actually displayed. It does not copy the photo library into Docker.

Each analysis has a stable dataset ID. Selecting a NAS dataset enables the link button. A link such as the following automatically loads the same tree and photo library for anyone who can reach that Synology service:

```text
http://SYNOLOGY_IP:8502/?dataset=analysis-2026-a
```

## NAS directory layout

The simplest layout needs no configuration file when there is exactly one tree file:

```text
/volume1/docker/phylophoto/data/
└── datasets/
    └── analysis-2026-a/
        ├── analysis.tree
        └── photos/
            ├── Full_tip_label_A/
            │   ├── photo1.jpg
            │   └── photo2.jpg
            └── Full_tip_label_B/
                └── photo1.jpg
```

For an explicit title, metadata, or paths, add `dataset.json` inside the analysis directory:

```json
{
  "title": "Acropora analysis 2026 A",
  "tree": "analysis.tree",
  "photos": "photos",
  "metadata": "metadata.csv"
}
```

Paths are relative to the dataset directory and must remain inside the mounted data root. Separate analysis directories can use different trees and photo libraries. They can also reference a shared photo library with a relative path such as `../../shared-photos/acropora`, provided the target remains inside the mounted data root.

## Optional browser upload

Each named analysis folder is one dataset: it contains that analysis's tree and its `photos/` folder. There is no extra category hierarchy. Large photo libraries should normally be copied directly into the NAS shared data folder and mounted read-only. Browser upload is available as a simpler fallback and writes only to a separate upload directory, never to the read-only library.

Create `client/.env` on the NAS:

```dotenv
PHYLOPHOTO_DATA_PATH=/volume1/docker/phylophoto/data
PHYLOPHOTO_UPLOAD_PATH=/volume1/docker/phylophoto/uploads
```

The collapsed **Upload dataset to NAS** panel is always available when the NAS service is running. Enter a new dataset name, choose its tree and photo folder, then upload. It creates `uploads/datasets/<dataset-id>/` for that analysis. Existing NAS analysis folders appear in the same selector and can be loaded directly.

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

- The main NAS data mount is read-only.
- Uploaded files use a separate writable mount.
- Dataset IDs and file paths are validated against path traversal.
- This deployment has no login: anyone who can reach the NAS service can view datasets and upload a dataset. Keep it inside a trusted LAN/VPN or protect it with your reverse proxy/firewall.
- PearTree visual settings remain browser-local and are not included in shared dataset links.
