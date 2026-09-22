# PhyloAtlas Windows Architecture

## 1. 系統分層

```text
PhyloAtlas.exe
│
├── WinUI 3 Shell
│   ├── MainWindow
│   ├── TitleBar
│   ├── Tree／Photo layout
│   ├── Settings drawer
│   ├── Rename drawer
│   └── Native PhotoViewerWindow
│
├── Application Services
│   ├── TreeDocumentService
│   ├── PhotoFolderService
│   ├── FolderMatchingService
│   ├── RenameService
│   ├── SettingsService
│   └── PreferencesService
│
├── PearTree WebView2 Host
│   ├── Local PearTree bundle
│   ├── viewer.html
│   ├── viewer.js
│   └── C# ↔ JavaScript message bridge
│
└── Local Storage
    ├── User settings
    ├── Window／drawer sizes
    └── Temporary rename backups
```

## 2. 原生 Windows 對應

| macOS 元件 | Windows 實作 |
|---|---|
| SwiftUI `WindowGroup` | WinUI 3 `Window`／`AppWindow` |
| AppKit `NSOpenPanel` | WinUI 3 `FileOpenPicker`／`FolderPicker` |
| `NSWorkspace` | `Process.Start`／Windows Shell association |
| WKWebView | WebView2 |
| `WKScriptMessageHandler` | WebView2 `WebMessageReceived` |
| `WKURLSchemeHandler` | WebView2 virtual host mapping 或本機資源 provider |
| AppKit photo canvas | WinUI `Image` + `ScrollViewer` + `MatrixTransform` |
| UserDefaults | `ApplicationData.Current.LocalSettings` 或 JSON preferences |
| `FileManager` | `System.IO`、`StorageFile`、`StorageFolder` |
| macOS window titlebar | WinUI custom title bar |

## 3. 建議 project 結構

```text
PhyloAtlas.Windows/
├── PhyloAtlas.Windows.sln
├── src/
│   ├── PhyloAtlas.App/
│   │   ├── App.xaml
│   │   ├── MainWindow.xaml
│   │   ├── MainWindow.xaml.cs
│   │   ├── Views/
│   │   ├── ViewModels/
│   │   ├── Services/
│   │   ├── Models/
│   │   └── Resources/
│   ├── PhyloAtlas.TreeText/
│   │   ├── NewickScanner.cs
│   │   ├── NexusScanner.cs
│   │   ├── TipLabelRenamer.cs
│   │   └── RenameModels.cs
│   ├── PhyloAtlas.PearTree/
│   │   ├── WebAssets/
│   │   ├── PearTreeHost.cs
│   │   └── PearTreeMessageBridge.cs
│   └── PhyloAtlas.PhotoViewer/
│       ├── PhotoViewerWindow.xaml
│       ├── PhotoViewerViewModel.cs
│       └── BoundedImageTransform.cs
├── tests/
│   ├── TreeTextTests/
│   ├── RenameSafetyTests/
│   ├── FolderMatchingTests/
│   └── PhotoViewerTests/
└── docs/
```

## 4. 資料流

### 開啟 Tree

```text
User clicks Load Phylogeny Tree
  → Windows FileOpenPicker
  → TreeDocumentService reads original bytes/text
  → detects Newick or NEXUS
  → extracts tip labels without rewriting source
  → sends display text to PearTree WebView2
  → UI enables settings, search, rename and folder actions
```

### 選擇 Photo folder

```text
User clicks Photo folder
  → Windows FolderPicker
  → PhotoFolderService scans direct child folders
  → supported images are indexed recursively
  → FolderMatchingService matches tip labels to folders
  → photo panel renders selected node's photos
```

### WebView2 bridge

WebView2 只交換結構化 JSON message，不直接允許 JavaScript 任意讀取 Windows file path。

```text
JavaScript → { action: "selectTips", tips: [...] }
C#        → { type: "selectionChanged", tips: [...] }

JavaScript → { action: "requestTreeSettings" }
C#        → { type: "treeSettings", settings: {...} }

JavaScript → { action: "highlightTips", tips: [...] }
C#        → { type: "loadTree", text: "...", filename: "..." }
```

## 5. 檔案權限與安全

- 使用者明確選擇 tree file 和 photo root 後才允許讀取。
- 所有 path 使用 `Path.GetFullPath` 正規化。
- 所有操作確認 path 位於使用者選定的 root 內。
- 不接受來自 WebView2 的任意絕對路徑。
- Rename 前檢查 tree file 的最後修改時間與 hash，避免檔案在外部被改過。
- Rename 期間建立 lock，避免同一 app 內重複執行。
- 失敗時保留 backup，不刪除使用者原始檔。
