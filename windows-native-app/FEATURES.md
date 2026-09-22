# PhyloAtlas Windows Feature Specification

## Core file support

支援：

- `.tree`
- `.treefile`
- `.nwk`
- `.newick`
- `.tre`
- `.nexus`
- `.nex`

Tree 讀取時保留原始文字。PearTree 得到的是顯示用資料，不能把 PearTree export 當成 rename 的寫回來源。

支援照片格式至少包含：

- JPG／JPEG
- PNG
- GIF
- WebP
- TIFF
- BMP
- HEIC／HEIF（Windows codec 可用時）

## PearTree 功能

Windows 版應保留 PearTree 現有功能：

- tree rendering
- zoom／fit／pan
- proportional／equal／original branch display
- search／filter
- colour／palette
- branch labels 與 bootstrap 顯示
- subtree 操作
- reroot、midpoint root、outgroup root
- settings palette
- selection event

Windows app 外殼只控制載入 tree、選取 tips、highlight、rooting request 與 settings 保存，不重寫 PearTree 內部 rendering。

## Node selection 與 highlight

- 點 PearTree node 時，photo panel 顯示該 node 對應的 tip／descendant photos。
- Header tip search 輸入部分字串時，自動找到第一個符合 tip。
- Previous／Next 對符合項目逐一 highlight。
- 到達第一個或最後一個時按鈕 disabled，不循環。
- 不因搜尋自動大幅改變 tree zoom 或強制置中，避免大型 tree 操作不穩定。
- highlight 要使用明顯的 selected label／node style。

## Photo matching

預設值：

- tip-to-folder key：Leading fields
- delimiter：`_`
- leading field count：`1`
- comparison：Starts with key

可選：

- Full tip label
- Leading fields
- Regular expression
- Equals key
- Starts with key
- Case sensitive
- Lazy photo loading

Folder warnings 要列出：

- tip label
- derived key
- missing／matched／ambiguous 狀態
- candidate folders

## Create tree tip folders

- 使用者選擇 Tree 後，可要求建立缺少的 tip folders。
- Windows 使用 folder picker 選擇建立目的地。
- 不直接在 tree file 所在位置建立。
- 先顯示將建立的 folder 清單。
- 已存在的 folder 不覆蓋、不刪除、不合併。
- 非法 Windows folder name 要列為 skipped／failed。
- 完成後重新掃描 photo root。

## Local preferences

保存：

- window size／position
- tree/photo split ratio
- Settings／Rename drawer width
- language
- matching defaults
- lazy photo loading
- PearTree visual settings

Preferences 不應寫回原始 tree 或 photo folder，除非使用者明確執行 rename／create folder。
