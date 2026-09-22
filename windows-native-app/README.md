# PhyloAtlas Windows Native App

這個資料夾是 PhyloAtlas Windows 原生版本的開發規格，供 Windows 電腦上的 ChatGPT／Codex 直接讀取。

Windows 版本不是 macOS app 的程式碼 porting，也不使用 Docker、Python、NAS server 或線上服務。它應該使用 Windows 原生架構重新實作，但在功能、操作流程與視覺層級上，與目前穩定的 PhyloAtlas macOS app 保持一致。

## 建議技術架構

- C#
- .NET 8 或更新的 LTS 版本
- WinUI 3
- Windows App SDK
- WebView2
- PearTree 本機 bundle
- Windows 原生檔案／資料夾 API
- WinUI 原生 photo viewer
- 不依賴 Docker、Python、NAS 或外部網路

WinUI 3 負責原生 Windows 視窗、標題列、面板、檔案選擇器與 photo viewer。WebView2 只負責承載 PearTree 與必要的 HTML/CSS/JavaScript tree viewer；它不是 server，也不是線上 client。

## 目前 macOS 版本參考

- App：PhyloAtlas
- macOS baseline commit：`9c85755`
- PearTree：內嵌本機 bundle
- Tree 格式：`.tree`、`.treefile`、`.nwk`、`.newick`、`.nexus`、`.nex`
- Photo folders：直接讀取使用者電腦上的資料夾
- Rename：直接修改原始 tree／NEXUS 文字，不重新產生 tree

目前 macOS 工作區可能包含比 `9c85755` 更新的 Rename UI 微調；Windows 版本應以使用者實際確認過的 macOS 行為作為 UX 參考，而不是盲目複製某一個 commit 的檔案。

## 閱讀順序

1. `ARCHITECTURE.md`：整體技術架構與資料流
2. `UI_SPEC.md`：視窗、面板與操作流程
3. `FEATURES.md`：完整功能與 Windows 原生 API 對應
4. `RENAME_SAFETY.md`：node／photo folder 更名的資料安全規格
5. `PHOTO_VIEWER.md`：原生 photo viewer 操作規格
6. `PEARTREE_INTEGRATION.md`：WebView2 與 PearTree 整合規格
7. `IMPLEMENTATION_PLAN.md`：分階段開發順序、測試與交付方式

## 絕對限制

1. 不可把 macOS Swift／SwiftUI／AppKit 程式碼直接 port 到 Windows。
2. 不可讓 app 依賴 Python、Docker、NAS、server 或網路。
3. 不可用 PearTree 重新輸出 tree 來執行 rename。
4. Rename 只能修改 leaf／tip labels。
5. 不可修改 internal node labels、bootstrap、support、branch length、annotation 或 topology。
6. Tree 與 photo folder 的 rename 必須先預覽、確認、備份，並可 rollback。
7. PearTree 資源必須隨 app 一起提供，不使用 CDN。
8. 所有 local file path 都必須限制在使用者選定的 tree／photo root 範圍內。
