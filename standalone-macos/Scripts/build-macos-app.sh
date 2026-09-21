#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
cd "$project_dir"

swift build -c release

app_path="$project_dir/dist/PhyloAtlas.app"
rm -rf "$app_path"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
cp "$project_dir/.build/release/PhyloAtlas" "$app_path/Contents/MacOS/PhyloAtlas"
cp "$project_dir/App/Info.plist" "$app_path/Contents/Info.plist"
cp -R "$project_dir/.build/release/PhyloPhotoStandalone_PhyloPhotoStandalone.bundle" "$app_path/Contents/Resources/"
bundle_path="$app_path/Contents/Resources/PhyloPhotoStandalone_PhyloPhotoStandalone.bundle"
# SwiftPM can leave processed resources stale in incremental release builds.
# The packaged app must always use the current checked-out web resources.
cp -R "$project_dir/Sources/PhyloPhotoStandalone/Resources/Web/." "$bundle_path/"
cp "$project_dir/icon/PhyloAtlas.icns" "$app_path/Contents/Resources/PhyloAtlas.icns"
cp "$project_dir/icon/PhyloAtlas-64.png" "$bundle_path/app-icon.png"

echo "Built $app_path"
