#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
cd "$project_dir"

swift build -c release

app_path="$project_dir/dist/PhyloPhoto.app"
rm -rf "$app_path"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
cp "$project_dir/.build/release/PhyloPhoto" "$app_path/Contents/MacOS/PhyloPhoto"
cp "$project_dir/App/Info.plist" "$app_path/Contents/Info.plist"
cp -R "$project_dir/.build/release/PhyloPhotoStandalone_PhyloPhotoStandalone.bundle" "$app_path/Contents/Resources/"

echo "Built $app_path"
