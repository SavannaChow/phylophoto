# Windows Native Photo Viewer

## Goal

提供與 macOS PhyloAtlas 相同的使用結果，但完全使用 Windows 原生 UI 與輸入事件。

## 建議控制項

- `Window` 或 `ContentDialog` 作為沉浸式 viewer
- `Grid` 作為黑色 viewer canvas
- `Image` 顯示照片
- `ScrollViewer` 或自訂 `Canvas` 控制 viewport
- `CompositeTransform`／`MatrixTransform` 控制 scale、translate
- WinUI `Button` 顯示下方浮動控制列

## Transform model

```text
fitScale = min(viewportWidth / imageWidth,
               viewportHeight / imageHeight)
scale = max(1.0, userZoom)
displayScale = fitScale * scale
```

規則：

- `userZoom = 1` 時照片 fit viewport。
- zoom out 不可低於 1。
- userZoom = 1 時 offset 永遠是零。
- zoom in 後 offset 受 image bounds clamp。
- pan 後照片不能離開 viewport 的有效邊界。
- window resize 時重新計算 fitScale 並 clamp offset。

## Input

- Mouse wheel：zoom 或 vertical pan，依 Windows 使用者習慣設計。
- Ctrl + wheel：zoom。
- Pointer drag：pan。
- Touchpad／precision touchpad：使用 pointer wheel delta 與 manipulation events。
- Touchscreen：手指同向拖曳圖片；pinch zoom。
- Arrow buttons：上一張／下一張。
- `+`／`−`：zoom。
- Direction buttons：pan。
- Reset：回到 fit。
- Esc：關閉 viewer。
- 單擊照片：關閉 viewer（若目前 UI 規則保留此行為）。
- Double-click：Windows Shell 開啟原始照片。

## Photo navigation

- photo list 保持原始 matching folder 的排序。
- viewer 開啟時保存 current index。
- 上一張／下一張不重新掃描資料夾。
- 若檔案在 viewer 開啟後消失，顯示錯誤並跳到下一個有效檔案。
- 不把完整 photo library 複製到記憶體；只在需要時載入圖片。
