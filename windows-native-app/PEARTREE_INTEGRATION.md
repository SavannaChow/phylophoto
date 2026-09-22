# PearTree and WebView2 Integration

## 1. Local resources

PearTree 相關檔案直接放在 app resources：

```text
Assets/Web/
├── viewer.html
├── viewer.js
├── viewer.css
└── peartree.bundle.min.js
```

不可從 CDN 載入，確保 standalone app 在離線環境仍可使用。

## 2. WebView2 host

C# host 負責：

- 初始化 WebView2。
- 確認 WebView2 Runtime 存在。
- 將本機 resource 映射成固定 local origin。
- 禁止外部導航與任意網路請求。
- 禁止 JavaScript 任意存取 Windows path。
- 設定 WebView2 user data folder 到 app local data。
- 處理 `WebMessageReceived`。
- 必要時呼叫 `ExecuteScriptAsync`。

## 3. Message contract

Message 必須是 versioned JSON：

```json
{
  "version": 1,
  "action": "selectTips",
  "payload": {
    "tips": ["S1", "S2"]
  }
}
```

建議 actions：

- `ready`
- `loadTree`
- `clearTree`
- `selectTips`
- `highlightTips`
- `requestTreeSettings`
- `saveTreeSettings`
- `applyRoot`
- `requestPhotoViewer`
- `renamePreview`
- `renameCommit`

## 4. PearTree bridge boundaries

PearTree viewer 只能處理：

- 顯示 tree
- Tree settings
- selected tips
- visual highlight
- rooting request

PearTree 不應負責：

- 直接讀 Windows files
- 直接寫 tree files
- 直接 rename photo folders
- 直接建立 folders
- 修改原始 tree text

所有檔案變更由 C# service 層執行。

## 5. Runtime distribution

選項：

### Evergreen WebView2

- App 體積較小。
- 使用系統共用 runtime。
- 適合一般 Windows 10／11 電腦。
- 啟動時必須檢查 runtime。

### Fixed Version WebView2

- App 自帶固定 runtime。
- 適合離線、實驗室、版本可重現需求。
- 安裝檔明顯變大。
- 需要自行更新 runtime。

預設建議 Evergreen；如果實際使用環境包含離線或受控 Windows 電腦，再採 Fixed Version。
