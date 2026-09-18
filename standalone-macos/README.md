# PhyloPhoto for macOS

This is a standalone macOS application. It does not run Docker, Python, a web server, or connect to the NAS service.

The app uses Finder dialogs to open a tree and select a photo root. It reads the selected directory directly, displays the bundled local PearTree viewer, matches tip labels to photo folders, and can create missing tip-named folders after confirmation.

## Build

```bash
cd standalone-macos
./Scripts/build-macos-app.sh
open dist/PhyloPhoto.app
```

The resulting app is at `standalone-macos/dist/PhyloPhoto.app`. It is unsigned for local development; distribution to other Macs needs Apple Developer signing and notarization.
