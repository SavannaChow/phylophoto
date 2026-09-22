# Rename Safety Specification

Rename 是 PhyloAtlas Windows 版最需要保守處理的功能。

## 1. 允許修改的內容

只允許修改 tip／leaf label，例如：

```text
(S1:0.12,S2:0.20);
```

可以修改：

```text
(Sample_1:0.12,Sample_2:0.20);
```

## 2. 禁止修改的內容

以下資料必須 byte-preserving 或 token-preserving：

- internal node labels
- bootstrap values
- support values
- branch lengths
- branch annotations
- comments
- NEXUS translate numbers
- topology
- NEXUS header／begin／end 結構
- quote style，除非該 quote 是必要的 label replacement

例如：

```text
((A:0.1,B:0.2)95:0.3,C:0.4);
```

更名 A、B 後，`95`、所有 branch length 與括號結構都必須保留。

## 3. Rename pipeline

```text
Load original text
  → scan leaf label spans
  → collect distinct matching labels
  → user chooses search／replacement／batch rules
  → generate before／after preview
  → parse result only for validation
  → verify topology and protected tokens are unchanged
  → check photo-folder rename conflicts
  → create backup
  → write temporary file
  → atomic replace original tree
  → rename photo folders using temporary names
  → reload tree and rescan photos
```

## 4. File safety

- 使用 UTF-8 讀取；若原始 encoding 無法確認，停止並提示，不要猜測。
- 保存原始 newline style。
- 先檢查 file size、last write time 與 SHA-256。
- 寫入前如果檔案已被其他程式改動，取消操作。
- backup 命名包含 timestamp 與 original hash。
- temporary file 必須位於同一 directory，確保 atomic replace 可用。
- replace 失敗時保留 temporary file 與 backup。
- rename folder 使用兩階段 temporary folder names，避免 A→B、B→A 互相覆蓋。

## 5. Photo folder safety

- 只處理目前 loaded photo root 的直接子資料夾。
- 不遞迴 rename 不相關資料夾。
- 先檢查所有 source folder 存在。
- 先檢查所有 target folder 不存在，除非 target 就是同一 folder。
- target labels 必須通過 Windows folder-name validation。
- 任何衝突都使整批操作取消。
- tree write 與 folder rename 任何一邊失敗，都執行 rollback。

## 6. Regex

- Literal mode：一般文字搜尋。
- Regex mode：使用 .NET `System.Text.RegularExpressions`。
- Regex 需設定 timeout，避免 catastrophic backtracking。
- 預覽表必須列出每一個實際會改變的 label。
- 空 replacement 必須明確允許或明確拒絕，不可意外變成空白名稱。
