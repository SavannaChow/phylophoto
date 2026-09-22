import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

@main
struct PhyloAtlasApp: App {
    var body: some Scene {
        WindowGroup("PhyloAtlas") {
            PhyloPhotoWebView()
                .ignoresSafeArea()
                .frame(minWidth: 980, minHeight: 700)
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact)
        .defaultSize(width: 1440, height: 940)
    }
}

private final class NativePhotoViewer: NSVisualEffectView {
    private let urls: [URL]
    private var index: Int
    private let canvas = NativePhotoCanvas()
    private let caption = NSTextField(labelWithString: "")
    private let openExternally: (URL) -> Void

    init(urls: [URL], index: Int, openExternally: @escaping (URL) -> Void) {
        self.urls = urls
        self.index = min(max(index, 0), urls.count - 1)
        self.openExternally = openExternally
        super.init(frame: .zero)
        material = .underWindowBackground
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.80).cgColor
        setupViews()
        showCurrentPhoto()
        DispatchQueue.main.async { [weak self] in self?.window?.makeFirstResponder(self) }
    }

    required init?(coder: NSCoder) { nil }
    override var acceptsFirstResponder: Bool { true }

    private func setupViews() {
        canvas.translatesAutoresizingMaskIntoConstraints = false
        canvas.onOpen = { [weak self] in self.map { $0.openExternally($0.urls[$0.index]) } }
        canvas.onClose = { [weak self] in self?.removeFromSuperview() }
        addSubview(canvas)

        caption.translatesAutoresizingMaskIntoConstraints = false
        caption.textColor = .secondaryLabelColor
        caption.alignment = .center
        caption.lineBreakMode = .byTruncatingMiddle
        addSubview(caption)

        let controls = NSStackView(views: [button("‹", #selector(previous)), button("›", #selector(next)), button("−", #selector(zoomOut)), button("+", #selector(zoomIn)), button("←", #selector(panLeft)), button("↑", #selector(panUp)), button("↓", #selector(panDown)), button("→", #selector(panRight)), button("Reset", #selector(resetPhoto)), button("×", #selector(closeViewer))])
        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.orientation = .horizontal
        controls.spacing = 4
        controls.edgeInsets = NSEdgeInsets(top: 5, left: 6, bottom: 5, right: 6)
        controls.wantsLayer = true
        controls.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.88).cgColor
        controls.layer?.cornerRadius = 9
        addSubview(controls)
        NSLayoutConstraint.activate([
            canvas.leadingAnchor.constraint(equalTo: leadingAnchor), canvas.trailingAnchor.constraint(equalTo: trailingAnchor), canvas.topAnchor.constraint(equalTo: topAnchor), canvas.bottomAnchor.constraint(equalTo: bottomAnchor),
            caption.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 32), caption.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -32), caption.bottomAnchor.constraint(equalTo: controls.topAnchor, constant: -7),
            controls.centerXAnchor.constraint(equalTo: centerXAnchor), controls.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -14)
        ])
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .texturedRounded
        button.controlSize = .small
        return button
    }

    private func showCurrentPhoto() {
        canvas.image = NSImage(contentsOf: urls[index])
        canvas.reset()
        caption.stringValue = "\(index + 1) / \(urls.count) · \(urls[index].lastPathComponent)"
    }

    @objc private func previous() { index = (index - 1 + urls.count) % urls.count; showCurrentPhoto() }
    @objc private func next() { index = (index + 1) % urls.count; showCurrentPhoto() }
    @objc private func zoomOut() { canvas.zoom(by: 1 / 1.2) }
    @objc private func zoomIn() { canvas.zoom(by: 1.2) }
    @objc private func panLeft() { canvas.pan(by: NSPoint(x: -48, y: 0)) }
    @objc private func panRight() { canvas.pan(by: NSPoint(x: 48, y: 0)) }
    @objc private func panUp() { canvas.pan(by: NSPoint(x: 0, y: 48)) }
    @objc private func panDown() { canvas.pan(by: NSPoint(x: 0, y: -48)) }
    @objc private func resetPhoto() { canvas.reset() }
    @objc private func closeViewer() { removeFromSuperview() }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: closeViewer()
        case 123: previous()
        case 124: next()
        case 125: panDown()
        case 126: panUp()
        default: super.keyDown(with: event)
        }
    }
}

private final class NativePhotoCanvas: NSView {
    var image: NSImage? { didSet { needsDisplay = true } }
    var onOpen: (() -> Void)?
    var onClose: (() -> Void)?
    private var scale: CGFloat = 1
    private var offset = NSPoint.zero
    private var lastDragPoint: NSPoint?
    private var didDrag = false

    override var acceptsFirstResponder: Bool { true }
    override func layout() { super.layout(); clampOffset(); needsDisplay = true }

    private func displayedSize() -> NSSize? {
        guard let image, image.size.width > 0, image.size.height > 0, bounds.width > 0, bounds.height > 0 else { return nil }
        let fit = min(bounds.width / image.size.width, bounds.height / image.size.height)
        return NSSize(width: image.size.width * fit * scale, height: image.size.height * fit * scale)
    }

    private func clampOffset() {
        guard let size = displayedSize() else { offset = .zero; return }
        let maxX = max(0, (size.width - bounds.width) / 2)
        let maxY = max(0, (size.height - bounds.height) / 2)
        offset.x = min(maxX, max(-maxX, offset.x))
        offset.y = min(maxY, max(-maxY, offset.y))
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill(); dirtyRect.fill()
        guard let image, let size = displayedSize() else { return }
        let rect = NSRect(x: bounds.midX - size.width / 2 + offset.x, y: bounds.midY - size.height / 2 + offset.y, width: size.width, height: size.height)
        image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    }

    override func magnify(with event: NSEvent) { zoom(by: 1 + event.magnification) }
    override func scrollWheel(with event: NSEvent) { pan(by: NSPoint(x: -event.scrollingDeltaX, y: -event.scrollingDeltaY)) }
    override func mouseDown(with event: NSEvent) { lastDragPoint = convert(event.locationInWindow, from: nil); didDrag = false }
    override func mouseDragged(with event: NSEvent) { let point = convert(event.locationInWindow, from: nil); if let lastDragPoint { let delta = NSPoint(x: point.x - lastDragPoint.x, y: point.y - lastDragPoint.y); if abs(delta.x) > 0.5 || abs(delta.y) > 0.5 { didDrag = true }; pan(by: delta) }; lastDragPoint = point }
    override func mouseUp(with event: NSEvent) { lastDragPoint = nil; if !didDrag && event.clickCount == 1 { onClose?() } }

    func zoom(by multiplier: CGFloat) { scale = min(8, max(1, scale * multiplier)); clampOffset(); needsDisplay = true }
    func pan(by delta: NSPoint) { guard scale > 1 else { return }; offset.x += delta.x; offset.y += delta.y; clampOffset(); needsDisplay = true }
    func reset() { scale = 1; offset = .zero; needsDisplay = true }
}

struct PhyloPhotoWebView: NSViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.isElementFullscreenEnabled = true
        configuration.userContentController.add(context.coordinator, name: "phylophotoNative")
        configuration.setURLSchemeHandler(context.coordinator, forURLScheme: "phylophoto")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        DispatchQueue.main.async {
            guard let window = webView.window else { return }
            window.styleMask.insert(.fullSizeContentView)
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.isMovableByWindowBackground = true
        }
        webView.load(URLRequest(url: URL(string: "phylophoto://app/index.html")!))
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKURLSchemeHandler {
        weak var webView: WKWebView?
        private let images = Set(["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "avif", "heic", "heif"])
        private let treeExtensions = Set(["newick", "nwk", "tree", "treefile", "tre", "nexus", "nex"])
        private var treeURL: URL?
        private var photoRoot: URL?
        private var photoViewer: NativePhotoViewer?
        private let recentPhotoFolderDefaultsKey = "PhyloAtlas.recentPhotoFolders"

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "phylophotoNative", let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
            DispatchQueue.main.async { [weak self] in self?.handle(action: action, body: body) }
        }

        private func handle(action: String, body: [String: Any]) {
            switch action {
            case "chooseTree": chooseTree(language: body["language"] as? String)
            case "openTree": openTree(mode: body["mode"] as? String)
            case "choosePhotoFolder": choosePhotoFolder(language: body["language"] as? String, hasTree: body["hasTree"] as? Bool ?? false)
            case "loadRecentPhotoFolders": sendRecentPhotoFolders()
            case "openRecentPhotoFolder": openRecentPhotoFolder(path: body["path"] as? String, language: body["language"] as? String, hasTree: body["hasTree"] as? Bool ?? false)
            case "refreshPhotoFolder": refreshPhotoFolder()
            case "openPhotoFolder": openPhotoFolder(body["folderName"] as? String)
            case "openPhoto": openPhoto(body["url"] as? String)
            case "showPhotoViewer": showPhotoViewer(urls: body["urls"] as? [String] ?? [], index: body["index"] as? Int ?? 0)
            case "saveExportedTree": saveExportedTree(content: body["content"] as? String, filename: body["filename"] as? String, language: body["language"] as? String)
            case "saveRenamedTree":
                let changes = (body["changes"] as? [[String: Any]] ?? []).compactMap { item -> (String, String)? in
                    guard let before = item["before"] as? String, let after = item["after"] as? String else { return nil }
                    return (before, after)
                }
                saveRenamedTree(original: body["originalText"] as? String, updated: body["updatedText"] as? String, renamePhotoFolders: body["renamePhotoFolders"] as? Bool ?? false, changes: changes)
            case "chooseTipFolderDestination":
                chooseTipFolderDestination((body["tips"] as? [String]) ?? [], language: body["language"] as? String)
            default: break
            }
        }

        private func localized(_ english: String, _ chinese: String, language: String?) -> String { language == "zh" ? chinese : english }

        private func chooseTree(language: String?) {
            let panel = NSOpenPanel()
            panel.title = localized("Open phylogeny tree", "開啟系統發生樹", language: language)
            panel.message = localized("Choose a Newick or NEXUS tree file.", "選擇 Newick 或 NEXUS 樹檔。", language: language)
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = [.plainText, UTType(filenameExtension: "newick")!, UTType(filenameExtension: "nwk")!, UTType(filenameExtension: "tree")!, UTType(filenameExtension: "treefile")!, UTType(filenameExtension: "tre")!, UTType(filenameExtension: "nexus")!, UTType(filenameExtension: "nex")!]
            guard panel.runModal() == .OK, let url = panel.url else { return }
            sendTree(url)
        }

        private func openTree(mode: String?) {
            guard let treeURL else {
                send(["type": "error", "message": "Open a tree first."])
                return
            }
            if mode == "text", let textEdit = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.TextEdit") {
                let configuration = NSWorkspace.OpenConfiguration()
                NSWorkspace.shared.open([treeURL], withApplicationAt: textEdit, configuration: configuration) { _, error in
                    if let error { DispatchQueue.main.async { [weak self] in self?.send(["type": "error", "message": "Could not open the tree in TextEdit: \(error.localizedDescription)"]) } }
                }
            } else if !NSWorkspace.shared.open(treeURL) {
                send(["type": "error", "message": "Could not open \(treeURL.lastPathComponent)."])
            }
        }

        private func openPhoto(_ source: String?) {
            guard let url = source.flatMap(URL.init(string:)), let target = validatedPhotoURL(from: url) else {
                send(["type": "error", "message": "Could not open that photo."])
                return
            }
            guard NSWorkspace.shared.open(target) else {
                send(["type": "error", "message": "Could not open \(target.lastPathComponent)."])
                return
            }
        }

        private func openPhotoFolder(_ folderName: String?) {
            guard let root = photoRoot, let folderName, !folderName.isEmpty, !folderName.contains("/") else {
                send(["type": "error", "message": "Could not open that photo folder."])
                return
            }
            let target = root.appendingPathComponent(folderName, isDirectory: true).standardizedFileURL
            guard target.deletingLastPathComponent() == root.standardizedFileURL,
                  (try? target.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
                  NSWorkspace.shared.open(target) else {
                send(["type": "error", "message": "Could not open (folderName)."])
                return
            }
        }

        private func showPhotoViewer(urls: [String], index: Int) {
            let files = urls.compactMap { URL(string: $0) }.compactMap(validatedPhotoURL(from:))
            guard !files.isEmpty, let webView else { return }
            let viewer = NativePhotoViewer(urls: files, index: index, openExternally: { [weak self] url in self?.openPhoto(self?.fileURL(for: url)) })
            viewer.frame = webView.bounds
            viewer.autoresizingMask = [.width, .height]
            webView.addSubview(viewer)
            photoViewer?.removeFromSuperview()
            photoViewer = viewer
        }

        private func sendTree(_ url: URL) {
            do {
                let treeURL = url.standardizedFileURL
                let text = try String(contentsOf: treeURL, encoding: .utf8)
                self.treeURL = treeURL
                send(["type": "tree", "text": text, "filename": treeURL.lastPathComponent, "path": treeURL.path])
            } catch {
                send(["type": "error", "message": "Could not read \(url.lastPathComponent): \(error.localizedDescription)"])
            }
        }

        private func saveRenamedTree(original: String?, updated: String?, renamePhotoFolders: Bool, changes: [(String, String)]) {
            guard let treeURL, let original, let updated else { send(["type": "error", "message": "Open a tree file before renaming labels."]); return }
            do {
                let onDisk = try String(contentsOf: treeURL, encoding: .utf8)
                guard onDisk == original else { throw NSError(domain: "PhyloAtlas", code: 1, userInfo: [NSLocalizedDescriptionKey: "The tree file changed on disk after it was loaded. Reload it before renaming labels."]) }
                let renamedFolders = renamePhotoFolders ? try renameMatchingPhotoFolders(changes) : 0
                do {
                    try updated.write(to: treeURL, atomically: true, encoding: .utf8)
                } catch {
                    if renamedFolders > 0 { _ = try? renameMatchingPhotoFolders(changes.map { ($0.1, $0.0) }) }
                    throw error
                }
                if renamedFolders > 0 { sendPhotoFolder() }
                sendTree(treeURL)
            } catch {
                send(["type": "error", "message": "Could not save renamed labels: \(error.localizedDescription)"])
            }
        }

        private func saveExportedTree(content: String?, filename: String?, language: String?) {
            guard let content, !content.isEmpty else {
                send(["type": "error", "message": localized("PearTree did not produce an export file.", "PearTree 沒有產生可匯出的檔案。", language: language)])
                return
            }
            let suggestedName = URL(fileURLWithPath: filename ?? "tree.nexus").lastPathComponent
            let panel = NSSavePanel()
            panel.title = localized("Export tree", "匯出 Tree", language: language)
            panel.message = localized("Choose where to save the PearTree export.", "選擇要儲存 PearTree 匯出檔的位置。", language: language)
            panel.prompt = localized("Export", "匯出", language: language)
            panel.nameFieldStringValue = suggestedName.isEmpty ? "tree.nexus" : suggestedName
            panel.canCreateDirectories = true
            panel.isExtensionHidden = false
            if let fileType = UTType(filenameExtension: URL(fileURLWithPath: panel.nameFieldStringValue).pathExtension) {
                panel.allowedContentTypes = [fileType]
            }
            guard panel.runModal() == .OK, let url = panel.url else { return }
            do {
                try content.write(to: url, atomically: true, encoding: .utf8)
                send(["type": "treeExported", "path": url.path])
            } catch {
                send(["type": "error", "message": localized("Could not save the exported tree: \(error.localizedDescription)", "無法儲存匯出的 Tree：\(error.localizedDescription)", language: language)])
            }
        }

        private func renameMatchingPhotoFolders(_ changes: [(String, String)]) throws -> Int {
            guard let root = photoRoot else { return 0 }
            var mapping: [String: String] = [:]
            for (before, after) in changes where before != after {
                if let existing = mapping[before], existing != after { throw NSError(domain: "PhyloAtlas", code: 2, userInfo: [NSLocalizedDescriptionKey: "One photo folder has conflicting rename targets: \(before)."] ) }
                mapping[before] = after
            }
            let manager = FileManager.default
            let active = mapping.compactMap { before, after -> (URL, URL)? in
                let source = root.appendingPathComponent(before, isDirectory: true), target = root.appendingPathComponent(after, isDirectory: true)
                return manager.fileExists(atPath: source.path) ? (source, target) : nil
            }
            guard !active.isEmpty else { return 0 }
            let targetNames = active.map { $0.1.lastPathComponent }
            guard Set(targetNames).count == targetNames.count else { throw NSError(domain: "PhyloAtlas", code: 3, userInfo: [NSLocalizedDescriptionKey: "Multiple photo folders would be renamed to the same name."]) }
            let sourceNames = Set(active.map { $0.0.lastPathComponent })
            for (_, target) in active where manager.fileExists(atPath: target.path) && !sourceNames.contains(target.lastPathComponent) {
                throw NSError(domain: "PhyloAtlas", code: 4, userInfo: [NSLocalizedDescriptionKey: "A target photo folder already exists: \(target.lastPathComponent)."])
            }
            var staged: [(URL, URL, URL)] = []
            do {
                for (source, target) in active {
                    let temporary = root.appendingPathComponent(".phyloatlas-rename-\(UUID().uuidString)", isDirectory: true)
                    try manager.moveItem(at: source, to: temporary)
                    staged.append((source, temporary, target))
                }
            } catch {
                for (source, temporary, _) in staged.reversed() where manager.fileExists(atPath: temporary.path) { try? manager.moveItem(at: temporary, to: source) }
                throw error
            }
            do {
                for (_, temporary, target) in staged { try manager.moveItem(at: temporary, to: target) }
            } catch {
                for (source, temporary, target) in staged.reversed() {
                    if manager.fileExists(atPath: target.path) { try? manager.moveItem(at: target, to: source) }
                    else if manager.fileExists(atPath: temporary.path) { try? manager.moveItem(at: temporary, to: source) }
                }
                throw error
            }
            return staged.count
        }

        private func choosePhotoFolder(language: String?, hasTree: Bool) {
            let panel = NSOpenPanel()
            panel.title = localized("Choose photo folder", "選擇照片資料夾", language: language)
            panel.message = localized("Choose the folder containing tip-named photo folders.", "選擇包含末端節點命名照片資料夾的上層資料夾。", language: language)
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            guard panel.runModal() == .OK, let url = panel.url else { return }
            photoRoot = url.standardizedFileURL
            rememberPhotoFolder(photoRoot!)
            sendPhotoFolder()
            if !hasTree { discoverTree(in: photoRoot!, language: language) }
        }

        private func openRecentPhotoFolder(path: String?, language: String?, hasTree: Bool) {
            guard let path, !path.isEmpty else { return }
            let url = URL(fileURLWithPath: path).standardizedFileURL
            guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                send(["type": "error", "message": localized("That recent photo folder is no longer available.", "該最近使用的照片資料夾已不存在或無法讀取。", language: language)])
                sendRecentPhotoFolders()
                return
            }
            photoRoot = url
            rememberPhotoFolder(url)
            sendPhotoFolder()
            if !hasTree { discoverTree(in: url, language: language) }
        }

        private func rememberPhotoFolder(_ url: URL) {
            let path = url.standardizedFileURL.path
            var paths = UserDefaults.standard.stringArray(forKey: recentPhotoFolderDefaultsKey) ?? []
            paths.removeAll { $0 == path }
            paths.insert(path, at: 0)
            UserDefaults.standard.set(Array(paths.prefix(30)), forKey: recentPhotoFolderDefaultsKey)
            sendRecentPhotoFolders()
        }

        private func sendRecentPhotoFolders() {
            let paths = UserDefaults.standard.stringArray(forKey: recentPhotoFolderDefaultsKey) ?? []
            let folders = paths.compactMap { path -> [String: String]? in
                let url = URL(fileURLWithPath: path).standardizedFileURL
                guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { return nil }
                return ["name": url.lastPathComponent, "path": url.path]
            }
            let validPaths = folders.compactMap { $0["path"] }
            if validPaths != paths { UserDefaults.standard.set(validPaths, forKey: recentPhotoFolderDefaultsKey) }
            send(["type": "recentPhotoFolders", "folders": folders])
        }

        private func discoverTree(in root: URL, language: String?) {
            let candidates = ((try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])) ?? []).filter { url in
                guard treeExtensions.contains(url.pathExtension.lowercased()) else { return false }
                return (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
            }.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
            guard !candidates.isEmpty else { return }
            if candidates.count == 1 { sendTree(candidates[0]); return }

            let alert = NSAlert()
            alert.messageText = localized("Choose a phylogeny tree", "選擇系統發生樹檔", language: language)
            alert.informativeText = localized("Found \(candidates.count) tree files in \(root.lastPathComponent).", "在「\(root.lastPathComponent)」找到 \(candidates.count) 個樹檔。", language: language)
            let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 360, height: 28), pullsDown: false)
            picker.addItems(withTitles: candidates.map(\.lastPathComponent))
            alert.accessoryView = picker
            alert.addButton(withTitle: localized("Open selected tree", "開啟所選樹檔", language: language))
            alert.addButton(withTitle: localized("Skip", "略過", language: language))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            sendTree(candidates[picker.indexOfSelectedItem])
        }

        private func refreshPhotoFolder() {
            guard photoRoot != nil else {
                send(["type": "error", "message": "Choose a photo folder first."])
                return
            }
            sendPhotoFolder()
        }

        private func sendPhotoFolder() {
            guard let root = photoRoot else { return }
            do {
                let files = try photoFiles(in: root)
                send(["type": "photoFolder", "name": root.lastPathComponent, "files": files, "folders": try photoFolderNames(in: root)])
            } catch {
                send(["type": "error", "message": "Could not read \(root.lastPathComponent): \(error.localizedDescription)"])
            }
        }

        private func photoFiles(in root: URL) throws -> [[String: String]] {
            let keys: Set<URLResourceKey> = [.isRegularFileKey, .isDirectoryKey]
            guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles]) else { return [] }
            var result: [[String: String]] = []
            for case let url as URL in enumerator {
                let values = try url.resourceValues(forKeys: keys)
                guard values.isRegularFile == true, images.contains(url.pathExtension.lowercased()) else { continue }
                let relative = url.path.replacingOccurrences(of: root.path + "/", with: "")
                result.append([
                    "name": url.lastPathComponent,
                    "relativePath": "\(root.lastPathComponent)/\(relative)",
                    "url": fileURL(for: url),
                    "type": mimeType(for: url)
                ])
            }
            return result.sorted { ($0["relativePath"] ?? "") < ($1["relativePath"] ?? "") }
        }

        private func photoFolderNames(in root: URL) throws -> [String] {
            try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
                .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
                .map(\.lastPathComponent)
                .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        }

        private func chooseTipFolderDestination(_ tips: [String], language: String?) {
            let invalid = tips.filter { $0.isEmpty || $0.contains("/") || $0.contains("\0") }
            let valid = tips.filter { !invalid.contains($0) }
            guard !valid.isEmpty else { send(["type": "foldersCreated", "count": 0, "skipped": invalid.count]); return }
            let panel = NSOpenPanel()
            panel.title = localized("Choose destination for tree tip folders", "選擇樹末端節點資料夾的位置", language: language)
            panel.message = localized("Choose the parent folder in which to create folders for the tree tips.", "選擇要建立各樹末端節點資料夾的上層資料夾。", language: language)
            panel.prompt = localized("Choose destination", "選擇位置", language: language)
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            guard panel.runModal() == .OK, let root = panel.url?.standardizedFileURL else { return }
            let missing = valid.filter { !FileManager.default.fileExists(atPath: root.appendingPathComponent($0, isDirectory: true).path) }
            guard !missing.isEmpty else { send(["type": "foldersCreated", "count": 0, "skipped": invalid.count, "destination": root.path]); return }
            let alert = NSAlert()
            alert.messageText = language == "zh" ? "建立 \(missing.count) 個尚未存在的末端節點資料夾？" : "Create \(missing.count) missing tip folder(s)?"
            alert.informativeText = language == "zh" ? "資料夾將建立在「\(root.lastPathComponent)」中；既有資料夾不會變動。" : "Folders will be created inside \(root.lastPathComponent). Existing folders are left unchanged."
            alert.addButton(withTitle: localized("Create folders", "建立資料夾", language: language))
            alert.addButton(withTitle: localized("Cancel", "取消", language: language))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            var created = 0
            var failures: [String] = []
            for tip in missing {
                do {
                    try FileManager.default.createDirectory(at: root.appendingPathComponent(tip, isDirectory: true), withIntermediateDirectories: false)
                    created += 1
                } catch { failures.append(tip) }
            }
            send(["type": "foldersCreated", "count": created, "skipped": invalid.count, "failed": failures, "destination": root.path])
        }

        private func fileURL(for url: URL) -> String {
            var components = URLComponents()
            components.scheme = "phylophoto"
            components.host = "file"
            components.queryItems = [URLQueryItem(name: "path", value: url.path)]
            return components.url!.absoluteString
        }

        private func validatedPhotoURL(from url: URL) -> URL? {
            guard url.scheme == "phylophoto", url.host == "file",
                  let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value,
                  let root = photoRoot else { return nil }
            let target = URL(fileURLWithPath: path).standardizedFileURL
            guard target.path.hasPrefix(root.path + "/") else { return nil }
            return target
        }

        private func mimeType(for url: URL) -> String {
            UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }

        private func send(_ payload: [String: Any]) {
            guard JSONSerialization.isValidJSONObject(payload), let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.PhyloPhotoNative?.receive(\(json));")
        }

        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            guard let url = urlSchemeTask.request.url else { urlSchemeTask.didFailWithError(URLError(.badURL)); return }
            do {
                let data: Data
                let mime: String
                if url.host == "app" {
                    let requested = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                    let root = Bundle.module.resourceURL!.standardizedFileURL
                    let target = root.appendingPathComponent(requested.isEmpty ? "index.html" : requested).standardizedFileURL
                    guard target.path.hasPrefix(root.path + "/") || target == root else { throw URLError(.noPermissionsToReadFile) }
                    data = try Data(contentsOf: target)
                    mime = mimeType(for: target)
                } else if let target = validatedPhotoURL(from: url) {
                    data = try Data(contentsOf: target)
                    mime = mimeType(for: target)
                } else {
                    throw URLError(.fileDoesNotExist)
                }
                let response = URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil)
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            } catch {
                urlSchemeTask.didFailWithError(error)
            }
        }

        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
    }
}
