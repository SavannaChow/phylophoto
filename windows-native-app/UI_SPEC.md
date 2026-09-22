# PhyloAtlas Windows UI Specification

Windows 版應與 macOS 版保持同樣的資訊架構，但使用 Windows 原生視窗與控制項。不要逐像素複製 macOS titlebar；保留同樣的操作順序、資訊階層與面板行為。

## 1. Main window

```text
┌─ Windows title bar ───────────────────────────────────────────────┐
│ PhyloAtlas     tree name   Open   Text   tip search  ‹ 1/10 ›     │
├─ command bar ──────────────────────────────────────────────────────┤
│ Refresh   Rename   Settings   Clear                                │
├──────────────────────────────┬─────────────────────────────────────┤
│                              │                                     │
│          PearTree             │          Photo panel                │
│                              │                                     │
│                              │                                     │
└──────────────────────────────┴─────────────────────────────────────┘
```

## 2. Tree panel

初始狀態：

- 顯示 PhyloAtlas inline vector mark 作為淡化背景。
- 顯示 `Load Phylogeny Tree` button。
- 不顯示破圖、外部圖片 URL 或需要網路的資源。

載入後：

- PearTree 填滿 Tree panel。
- Tree panel 可縮放與捲動。
- 保留 PearTree 的 toolbar、palette、branch display、rooting、filter、colour 等操作。

## 3. Photo panel

初始狀態：

- 不放 logo 背景。
- 顯示與左側同高度的 `Open Photo Folder` button。

選取 tip 後：

- 顯示 matching folder 名稱。
- 有照片時顯示照片縮圖／照片列表。
- 沒有照片時顯示 `No photos in the matched folder.`。
- folder 名稱與空資料夾訊息保持可點擊，呼叫 Windows Explorer 開啟該資料夾。

## 4. Settings drawer

- 從右側滑入。
- 寬度可拖曳調整。
- 寬度寫入本機 preferences，下次啟動恢復。
- 高度永遠不超過 app window。
- 內容區獨立 vertical scroll。
- 點外部區域收回。
- 包含：
  - Language
  - Node selection
  - Tree settings
  - Photo folders
  - Rooting / outgroup
  - Folder warnings

## 5. Rename drawer

- 從 Settings 左側的 `Rename` button 開啟，或使用 command bar 的 Rename。
- 右側滑入，使用與 Settings 相同的拖曳 resizer。
- Rename drawer 的寬度與 Settings drawer 共用記憶值。
- 點外部不直接確認，也不直接取消。
- 由 `Confirm rename` 與 `Cancel` 明確控制。
- 確認成功後保留 Rename drawer 開啟，但清空搜尋、取代、batch、預覽內容。

### Rename controls 順序

```text
Search mode
Search
Replace with       [Preview changes]
Rename matching photo folders [checked]
Batch rules
Matching node labels
Before → After preview table
[Confirm rename] [Cancel]
```

### 搜尋流程

- 輸入文字後立即顯示不同的 matching leaf labels。
- 可用方向鍵選擇。
- Enter 將選定 label 帶入 Search 與 Replace with。
- Replace with 只提供已搜尋到的 label 建議，降低誤改名稱風險。
- 搜尋欄與取代欄都要有清除 X。

## 6. Photo viewer window

- 原生 WinUI window 或 modal overlay。
- 黑色／半透明背景。
- 照片 fit window 作為初始狀態。
- zoom out 不可小於 fit。
- fit 狀態不可 pan。
- zoom in 後 pan 只能到照片邊界。
- 上下左右操作方向與觸控板／觸控螢幕直覺一致。
- 一點照片可關閉 viewer；double-click 使用 Windows 預設圖片程式開啟。
- 右下或下方提供低干擾 floating controls：上一張、下一張、zoom in、zoom out、reset、close。
