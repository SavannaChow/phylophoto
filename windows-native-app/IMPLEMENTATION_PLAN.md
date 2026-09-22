# Windows Implementation Plan

## Phase 0 — 開發環境與基線

建立：

- WinUI 3 packaged 或 unpackaged project
- .NET LTS
- WebView2 dependency
- local PearTree assets
- solution／test projects
- Windows icon 與 app manifest

驗證：

- Windows 10／11 可啟動
- offline 可載入 PearTree
- WebView2 不允許外部 navigation

## Phase 1 — Window shell 與基本 Tree/photo

完成：

- MainWindow
- title bar
- tree/photo split layout
- Windows tree picker
- Windows photo folder picker
- local tree loading
- local photo indexing
- PearTree rendering
- clear／refresh

這一階段先不寫入任何使用者檔案。

## Phase 2 — Settings 與 matching

完成：

- Settings drawer
- width resize and persistence
- language selection
- node selection
- tree display settings
- photo matching settings
- rooting/outgroup controls
- folder warnings
- responsive resizing

## Phase 3 — Search and highlight

完成：

- header tip search
- live matching
- previous／next
- boundary disabled state
- PearTree selected-tip highlight
- 不自動危險地置中大型 tree

## Phase 4 — Native photo viewer

完成：

- fit image
- zoom clamp
- pan clamp
- touchpad／mouse／touch input
- floating controls
- previous／next
- close／reset
- Windows default photo app opening

## Phase 5 — Rename preview

完成：

- Rename drawer
- width resize shared with Settings
- live search labels
- keyboard navigation
- replacement suggestions
- batch rules
- regex with timeout
- before／after preview table
- cancel／clear behavior

這一階段仍可只做 preview，不寫入檔案。

## Phase 6 — Safe rename commit

完成：

- feature flag
- file hash／mtime guard
- backup
- temporary file
- atomic replace
- protected token verification
- photo folder conflict validation
- two-phase folder rename
- rollback
- reload tree and rescan photos

建議只有 Phase 6 通過完整測試後才預設開啟寫入功能。

## Phase 7 — Packaging

選擇：

- MSIX：安裝與更新較完整。
- Unpackaged self-contained folder：較接近免安裝需求。
- WebView2 Evergreen 或 Fixed Version。

要提供：

- x64 build
- ARM64 build（若有需求）
- app icon
- version number
- runtime requirement 說明
- backup／rename 使用說明

## 測試清單

### Tree

- Newick、NEXUS、Translate block
- quoted labels
- spaces、Unicode、中文 label
- bootstrap 與 branch length 保留
- malformed tree 不會覆蓋原檔

### Rename

- 只改 leaf labels
- internal numeric support 不變
- branch lengths 不變
- NEXUS translate 不被錯改
- regex timeout
- duplicate target
- Windows illegal filename characters
- file changed on disk
- atomic replace failure
- rollback

### Photo

- empty folder
- missing folder
- ambiguous matching
- nested photos
- large photo folder
- photo file deleted during viewer
- zoom out fit clamp
- pan boundary clamp

### UI

- 100%／125%／150% display scaling
- narrow window
- high DPI
- dark／light Windows theme
- touchpad
- mouse only
- touchscreen if available
- WebView2 runtime missing
- offline launch
