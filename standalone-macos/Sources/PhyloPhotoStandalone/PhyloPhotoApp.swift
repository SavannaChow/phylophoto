import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

@main
struct PhyloPhotoApp: App {
    var body: some Scene {
        WindowGroup("PhyloPhoto") {
            PhyloPhotoWebView()
                .frame(minWidth: 980, minHeight: 700)
        }
        .defaultSize(width: 1440, height: 940)
    }
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
        webView.load(URLRequest(url: URL(string: "phylophoto://app/index.html")!))
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKURLSchemeHandler {
        weak var webView: WKWebView?
        private let images = Set(["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "avif", "heic", "heif"])
        private var photoRoot: URL?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "phylophotoNative", let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
            DispatchQueue.main.async { [weak self] in self?.handle(action: action, body: body) }
        }

        private func handle(action: String, body: [String: Any]) {
            switch action {
            case "chooseTree": chooseTree()
            case "choosePhotoFolder": choosePhotoFolder()
            case "refreshPhotoFolder": refreshPhotoFolder()
            case "createMissingTipFolders":
                createMissingTipFolders((body["tips"] as? [String]) ?? [])
            default: break
            }
        }

        private func chooseTree() {
            let panel = NSOpenPanel()
            panel.title = "Open phylogeny tree"
            panel.message = "Choose a Newick or NEXUS tree file."
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = [.plainText, UTType(filenameExtension: "newick")!, UTType(filenameExtension: "nwk")!, UTType(filenameExtension: "tree")!, UTType(filenameExtension: "tre")!, UTType(filenameExtension: "nexus")!, UTType(filenameExtension: "nex")!]
            guard panel.runModal() == .OK, let url = panel.url else { return }
            do {
                let text = try String(contentsOf: url, encoding: .utf8)
                send(["type": "tree", "text": text, "filename": url.lastPathComponent])
            } catch {
                send(["type": "error", "message": "Could not read \(url.lastPathComponent): \(error.localizedDescription)"])
            }
        }

        private func choosePhotoFolder() {
            let panel = NSOpenPanel()
            panel.title = "Choose photo folder"
            panel.message = "Choose the folder containing tip-named photo folders."
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            guard panel.runModal() == .OK, let url = panel.url else { return }
            photoRoot = url.standardizedFileURL
            sendPhotoFolder()
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
                send(["type": "photoFolder", "name": root.lastPathComponent, "files": files])
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

        private func createMissingTipFolders(_ tips: [String]) {
            guard let root = photoRoot else {
                send(["type": "error", "message": "Choose a photo folder first."])
                return
            }
            let invalid = tips.filter { $0.isEmpty || $0.contains("/") || $0.contains("\0") }
            let valid = tips.filter { !invalid.contains($0) }
            let missing = valid.filter { !FileManager.default.fileExists(atPath: root.appendingPathComponent($0, isDirectory: true).path) }
            guard !missing.isEmpty else {
                send(["type": "foldersCreated", "count": 0, "skipped": invalid.count])
                return
            }
            let alert = NSAlert()
            alert.messageText = "Create \(missing.count) missing tip folder(s)?"
            alert.informativeText = "Folders will be created directly inside \(root.lastPathComponent). Existing folders are left unchanged."
            alert.addButton(withTitle: "Create folders")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            var created = 0
            var failures: [String] = []
            for tip in missing {
                do {
                    try FileManager.default.createDirectory(at: root.appendingPathComponent(tip, isDirectory: true), withIntermediateDirectories: false)
                    created += 1
                } catch { failures.append(tip) }
            }
            send(["type": "foldersCreated", "count": created, "skipped": invalid.count, "failed": failures])
            sendPhotoFolder()
        }

        private func fileURL(for url: URL) -> String {
            var components = URLComponents()
            components.scheme = "phylophoto"
            components.host = "file"
            components.queryItems = [URLQueryItem(name: "path", value: url.path)]
            return components.url!.absoluteString
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
                } else if url.host == "file", let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value, let root = photoRoot {
                    let target = URL(fileURLWithPath: path).standardizedFileURL
                    guard target.path.hasPrefix(root.path + "/") else { throw URLError(.noPermissionsToReadFile) }
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
