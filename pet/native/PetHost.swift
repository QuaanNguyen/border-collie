import AppKit
import Carbon
import Darwin
import Foundation
import WebKit

struct PetConfig: Decodable {
    let schemaVersion: Int
    let baseWidth: Double
    let baseHeight: Double
    let scales: [Double]
    let defaultScale: Double
    let animationTracks: [String: AnimationTrackConfig]
    let stateAnimations: [String: String]

    func clamp(_ value: Double) -> Double {
        return min(scales.last ?? defaultScale, max(scales.first ?? defaultScale, value))
    }
}

struct AnimationTrackConfig: Decodable {
    let folder: String
    let frameDurationsMs: [Double]
}

private struct AnimationManifest: Decodable {
    let schemaVersion: Int
    let frames: [AnimationFrame]
}

private struct AnimationFrame: Decodable {
    let animation: String
    let index: Int
    let file: String
}

enum PetConfigurationError: LocalizedError {
    case invalid(String)

    var errorDescription: String? {
        if case let .invalid(message) = self { return message }
        return nil
    }
}

private func argument(_ name: String) -> String? {
    let prefix = "--\(name)="
    return CommandLine.arguments.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
}

private func loadPetConfig(at petDirectory: URL) throws -> PetConfig {
    let url = petDirectory.deletingLastPathComponent().appendingPathComponent("events/pet-config.json")
    let config = try JSONDecoder().decode(PetConfig.self, from: Data(contentsOf: url))
    guard config.schemaVersion == 1, !config.scales.isEmpty else {
        throw PetConfigurationError.invalid("unsupported Pet configuration")
    }
    return config
}

private func rendererConfiguration(
    petDirectory: URL,
    eventURL: URL,
    config: PetConfig,
    scale: Double,
    shortcut: String
) throws -> [String: Any] {
    let root = petDirectory.appendingPathComponent("assets/default-animations", isDirectory: true).standardizedFileURL
    let manifest = try JSONDecoder().decode(
        AnimationManifest.self,
        from: Data(contentsOf: root.appendingPathComponent("manifest.json"))
    )
    guard manifest.schemaVersion == 1 else {
        throw PetConfigurationError.invalid("unsupported runtime animation manifest")
    }

    var tracks: [String: [String: Any]] = [:]
    for (name, track) in config.animationTracks {
        guard !track.folder.isEmpty,
              ![".", ".."].contains(track.folder),
              URL(fileURLWithPath: track.folder).lastPathComponent == track.folder else {
            throw PetConfigurationError.invalid("animation \(name) contains an invalid folder")
        }
        guard !track.frameDurationsMs.isEmpty,
              track.frameDurationsMs.allSatisfy({ $0.isFinite && $0 > 0 && $0 <= 60_000 }) else {
            throw PetConfigurationError.invalid("animation \(name) contains an invalid frame duration")
        }
        let frames = manifest.frames.filter { $0.animation == name }.sorted { $0.index < $1.index }
        guard frames.count == track.frameDurationsMs.count else {
            throw PetConfigurationError.invalid("animation \(name) frame and duration counts differ")
        }
        let directory = root.appendingPathComponent(track.folder, isDirectory: true).standardizedFileURL
        let sources = try frames.enumerated().map { offset, frame -> String in
            let url = root.appendingPathComponent(frame.file).standardizedFileURL
            guard frame.index == offset + 1,
                  url.path.hasPrefix(root.path + "/"),
                  url.deletingLastPathComponent() == directory else {
                throw PetConfigurationError.invalid("animation \(name) contains an invalid frame")
            }
            return "data:image/png;base64,\(try Data(contentsOf: url).base64EncodedString())"
        }
        tracks[name] = ["frames": sources, "frameDurationsMs": track.frameDurationsMs]
    }

    let animations = try Dictionary(uniqueKeysWithValues: config.stateAnimations.map { state, name in
        guard let track = tracks[name] else {
            throw PetConfigurationError.invalid("state \(state) refers to unknown animation \(name)")
        }
        return (state, track)
    })
    guard animations["calm"] != nil else {
        throw PetConfigurationError.invalid("Pet configuration must map the calm state")
    }
    return [
        "eventsFile": eventURL.path,
        "solid": false,
        "dev": false,
        "scale": scale,
        "toggleKey": shortcut.replacingOccurrences(of: "Alt", with: "Option"),
        "animations": animations,
    ]
}

private func base64JSON(_ value: Any) throws -> String {
    return try JSONSerialization.data(withJSONObject: value).base64EncodedString()
}

private func rectangles(_ value: Any?) -> [CGRect] {
    guard let values = value as? [[String: Any]] else { return [] }
    return values.compactMap { item in
        guard let x = (item["x"] as? NSNumber)?.doubleValue,
              let y = (item["y"] as? NSNumber)?.doubleValue,
              let width = (item["width"] as? NSNumber)?.doubleValue,
              let height = (item["height"] as? NSNumber)?.doubleValue,
              width > 0,
              height > 0 else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }
}

private func enclosingRectangle(_ rectangles: [CGRect]) -> CGRect? {
    guard var bounds = rectangles.first else { return nil }
    for rectangle in rectangles.dropFirst() { bounds = bounds.union(rectangle) }
    return bounds
}

private final class OwnerRegistry {
    private let directory: URL
    private let lockDescriptor: Int32
    private let keepWithoutOwner: Bool

    init(dataDirectory: URL, ownerPID: Int32?) throws {
        directory = dataDirectory.appendingPathComponent("owners", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        keepWithoutOwner = ownerPID == nil
        if let ownerPID { try Data().write(to: directory.appendingPathComponent(String(ownerPID)), options: .atomic) }
        lockDescriptor = open(dataDirectory.appendingPathComponent("pet.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        if lockDescriptor < 0 { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }

    func acquire() -> Bool { return flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 }

    func hasOwners() -> Bool {
        if keepWithoutOwner { return true }
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return false }
        var live = false
        for name in names {
            guard let pid = Int32(name) else { continue }
            if kill(pid, 0) == 0 || errno == EPERM {
                live = true
            } else {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
            }
        }
        return live
    }

    deinit { close(lockDescriptor) }
}

private final class EventInbox {
    private let url: URL
    private var offset: UInt64 = 0
    private var carry = Data()
    private var seen = Set<String>()
    var onEvent: (([String: Any]) -> Void)?

    init(url: URL, offset: UInt64?) {
        self.url = url
        if let offset {
            self.offset = offset
        } else if let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) {
            self.offset = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
        }
    }

    func drain() {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else {
            reset()
            return
        }
        let size = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
        if size < offset { reset() }
        if size == offset { return }
        guard let handle = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? handle.close() }
        guard (try? handle.seek(toOffset: offset)) != nil,
              let data = try? handle.readToEnd() else { return }
        offset += UInt64(data.count)
        carry.append(data)
        while let newline = carry.firstIndex(of: 10) {
            let line = Data(carry[..<newline])
            carry.removeSubrange(...newline)
            guard !line.isEmpty,
                  let event = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            let key = "\(event["runId"] ?? ""):\(event["seq"] ?? "")"
            if seen.insert(key).inserted { onEvent?(event) }
        }
    }

    private func reset() {
        offset = 0
        carry.removeAll()
        seen.removeAll()
    }
}

private final class GlobalShortcut {
    private let action: () -> Void
    private var handler: EventHandlerRef?
    private var hotKey: EventHotKeyRef?

    init?(value: String, action: @escaping () -> Void) {
        let parts = value.split(separator: "+").map { String($0).lowercased() }
        guard let key = parts.last, let keyCode = ["r": kVK_ANSI_R, "9": kVK_ANSI_9][key] else { return nil }
        self.action = action
        var modifiers: UInt32 = 0
        if parts.contains("control") || parts.contains("ctrl") { modifiers |= UInt32(controlKey) }
        if parts.contains("alt") || parts.contains("option") { modifiers |= UInt32(optionKey) }
        if parts.contains("shift") { modifiers |= UInt32(shiftKey) }
        if parts.contains("command") || parts.contains("cmd") { modifiers |= UInt32(cmdKey) }
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard InstallEventHandler(GetApplicationEventTarget(), shortcutHandler, 1, &event, context, &handler) == noErr,
              RegisterEventHotKey(UInt32(keyCode), modifiers, EventHotKeyID(signature: 0x4243_5054, id: 1), GetApplicationEventTarget(), 0, &hotKey) == noErr else {
            if let handler { RemoveEventHandler(handler) }
            return nil
        }
    }

    func invoke() { action() }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
    }
}

private func shortcutHandler(
    _ next: EventHandlerCallRef?,
    _ event: EventRef?,
    _ context: UnsafeMutableRawPointer?
) -> OSStatus {
    if let context { Unmanaged<GlobalShortcut>.fromOpaque(context).takeUnretainedValue().invoke() }
    return noErr
}

private final class UserBridge: NSObject, WKScriptMessageHandler {
    weak var host: PetHost?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        host?.receive(name: message.name, body: message.body)
    }
}

private final class PetPanel: NSPanel {
    weak var host: PetHost?
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    override func sendEvent(_ event: NSEvent) {
        switch event.type {
        case .leftMouseDown:
            if host?.beginDrag(event) == true { return }
        case .leftMouseDragged:
            if host?.continueDrag() == true { return }
        case .leftMouseUp:
            if host?.endDrag() == true { return }
        default:
            break
        }
        super.sendEvent(event)
    }
}

private final class PetWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { return true }
}

final class PetHost: NSObject {
    private let petDirectory: URL
    private let dataDirectory: URL
    private let eventURL: URL
    private let owners: OwnerRegistry
    private let config: PetConfig
    private let inbox: EventInbox
    private var panel: PetPanel!
    private var webView: PetWebView!
    private var bridge: UserBridge!
    private var shortcut: GlobalShortcut?
    private var scale: Double
    private var hitRegions: [CGRect] = []
    private var dragRegions: [CGRect] = []
    private var timers: [Timer] = []
    private var dragging = false
    private var dragOffset: CGPoint?
    private var lastDragPointerX: CGFloat?

    fileprivate init(petDirectory: URL, dataDirectory: URL, eventURL: URL, eventOffset: UInt64?, owners: OwnerRegistry, config: PetConfig) {
        self.petDirectory = petDirectory
        self.dataDirectory = dataDirectory
        self.eventURL = eventURL
        self.owners = owners
        self.config = config
        inbox = EventInbox(url: eventURL, offset: eventOffset)
        scale = config.defaultScale
        super.init()
    }

    func start(shortcut shortcutValue: String) throws {
        try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
        let saved = loadSettings()
        scale = config.clamp((saved?["scale"] as? NSNumber)?.doubleValue ?? config.defaultScale)
        panel = PetPanel(contentRect: initialFrame(saved), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.host = self
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true

        bridge = UserBridge()
        bridge.host = self
        let renderer = try rendererConfiguration(
            petDirectory: petDirectory,
            eventURL: eventURL,
            config: config,
            scale: scale,
            shortcut: shortcutValue
        )
        let controller = WKUserContentController()
        for name in ["hitRegions", "scaleSet"] { controller.add(bridge, name: name) }
        controller.addUserScript(WKUserScript(source: bridgeScript(config: try base64JSON(renderer)), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let webConfig = WKWebViewConfiguration()
        webConfig.userContentController = controller
        webConfig.websiteDataStore = .nonPersistent()
        webConfig.setValue(false, forKey: "drawsBackground")
        webView = PetWebView(frame: panel.contentView!.bounds, configuration: webConfig)
        webView.autoresizingMask = [.width, .height]
        webView.underPageBackgroundColor = .clear
        webView.pageZoom = scale
        panel.contentView = webView

        inbox.onEvent = { [weak self] in self?.sendEvent($0) }
        webView.loadFileURL(petDirectory.appendingPathComponent("src/index.html"), allowingReadAccessTo: petDirectory)
        panel.orderFrontRegardless()
        shortcut = GlobalShortcut(value: shortcutValue) { [weak self] in self?.toggleVisible() }
        startTimers()
    }

    private func bridgeScript(config: String) -> String {
        return """
        (() => {
          const config = JSON.parse(atob('\(config)'))
          const pendingEvents = []
          let eventHandler = null, scaledHandler = () => {}, dragHandler = () => {}
          window.__borderCollieEvent = event => eventHandler ? eventHandler(event) : pendingEvents.push(event)
          window.__borderCollieScaled = value => scaledHandler(value)
          window.__borderCollieDragged = event => dragHandler(event)
          window.borderCollie = {
            config: () => Promise.resolve(config),
            setHitRegions: (hit, drag) => window.webkit.messageHandlers.hitRegions.postMessage({ hit, drag }),
            setScale: value => window.webkit.messageHandlers.scaleSet.postMessage(value),
            onScaled: handler => { scaledHandler = handler },
            onDrag: handler => { dragHandler = handler },
            onEvent: handler => {
              eventHandler = handler
              while (pendingEvents.length) handler(pendingEvents.shift())
            },
          }
        })()
        """
    }

    fileprivate func receive(name: String, body: Any) {
        switch name {
        case "hitRegions":
            guard let value = body as? [String: Any] else { return }
            hitRegions = rectangles(value["hit"])
            dragRegions = rectangles(value["drag"])
            updateMouseAcceptance()
        case "scaleSet": setScale((body as? NSNumber)?.doubleValue ?? scale)
        default: break
        }
    }

    private func startTimers() {
        timers = [
            timer(every: 1.0 / 30.0) { [weak self] in self?.updateMouseAcceptance() },
            timer(every: 0.15) { [weak self] in self?.inbox.drain() },
            timer(every: 0.5) { [weak self] in
                guard let self else { return }
                if !owners.hasOwners() { NSApp.terminate(nil) }
            },
        ]
    }

    private func timer(every interval: TimeInterval, action: @escaping () -> Void) -> Timer {
        let timer = Timer(timeInterval: interval, repeats: true) { _ in action() }
        RunLoop.main.add(timer, forMode: .common)
        return timer
    }

    private func rendererPoint(_ point: CGPoint) -> CGPoint {
        return CGPoint(x: point.x / scale, y: (panel.frame.height - point.y) / scale)
    }

    private func updateMouseAcceptance() {
        guard panel.isVisible else { return }
        if dragging {
            panel.ignoresMouseEvents = false
            return
        }
        let point = rendererPoint(panel.convertPoint(fromScreen: NSEvent.mouseLocation))
        panel.ignoresMouseEvents = !hitRegions.contains { $0.contains(point) }
    }

    fileprivate func beginDrag(_ event: NSEvent) -> Bool {
        guard dragRegions.contains(where: { $0.contains(rendererPoint(event.locationInWindow)) }) else { return false }
        let pointer = NSEvent.mouseLocation
        dragging = true
        dragOffset = CGPoint(x: pointer.x - panel.frame.minX, y: pointer.y - panel.frame.minY)
        lastDragPointerX = pointer.x
        panel.ignoresMouseEvents = false
        reportDrag(phase: "start", deltaX: 0)
        return true
    }

    fileprivate func continueDrag() -> Bool {
        guard dragging, let dragOffset else { return false }
        let pointer = NSEvent.mouseLocation
        let deltaX = pointer.x - (lastDragPointerX ?? pointer.x)
        panel.setFrameOrigin(NSPoint(x: pointer.x - dragOffset.x, y: pointer.y - dragOffset.y))
        lastDragPointerX = pointer.x
        reportDrag(phase: "move", deltaX: deltaX)
        return true
    }

    fileprivate func endDrag() -> Bool {
        guard dragging else { return false }
        dragging = false
        dragOffset = nil
        lastDragPointerX = nil
        reportDrag(phase: "end", deltaX: 0)
        saveSettings()
        updateMouseAcceptance()
        return true
    }

    private func sendEvent(_ event: [String: Any]) {
        guard let encoded = try? base64JSON(event) else { return }
        webView.evaluateJavaScript("window.__borderCollieEvent(JSON.parse(atob('\(encoded)')))" )
    }

    private func reportDrag(phase: String, deltaX: CGFloat) {
        let event: [String: Any] = ["phase": phase, "deltaX": deltaX]
        guard let encoded = try? base64JSON(event) else { return }
        webView.evaluateJavaScript("window.__borderCollieDragged(JSON.parse(atob('\(encoded)')))")
    }

    private func toggleVisible() {
        if panel.isVisible { panel.orderOut(nil) } else {
            panel.orderFrontRegardless()
            updateMouseAcceptance()
        }
    }

    private func setScale(_ value: Double) {
        let next = config.clamp(value)
        if next == scale { return }
        scale = next
        applyLayout()
        webView.evaluateJavaScript("window.__borderCollieScaled(\(Int(round(scale * 100))))")
    }

    private func applyLayout() {
        let old = panel.frame
        let width = config.baseWidth * scale
        let height = config.baseHeight * scale
        var next = NSRect(x: old.maxX - width, y: old.minY, width: width, height: height)
        if let visible = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame {
            next = constrainedFrame(next, to: visible)
        }
        panel.setFrame(next, display: true)
        webView.pageZoom = scale
        saveSettings()
    }

    private func constrainedFrame(_ frame: NSRect, to visible: NSRect) -> NSRect {
        guard let content = enclosingRectangle(dragRegions) else {
            var next = frame
            next.origin.x = max(visible.minX, min(next.origin.x, visible.maxX - frame.width))
            next.origin.y = max(visible.minY, min(next.origin.y, visible.maxY - frame.height))
            return next
        }
        let minimumX = visible.minX - content.minX * scale
        let maximumX = visible.maxX - content.maxX * scale
        let minimumY = visible.minY - (frame.height - content.maxY * scale)
        let maximumY = visible.maxY - (frame.height - content.minY * scale)
        var next = frame
        next.origin.x = minimumX > maximumX ? minimumX : max(minimumX, min(next.origin.x, maximumX))
        next.origin.y = minimumY > maximumY ? minimumY : max(minimumY, min(next.origin.y, maximumY))
        return next
    }

    private var settingsURL: URL { return dataDirectory.appendingPathComponent("pet-settings.json") }

    private func loadSettings() -> [String: Any]? {
        guard let data = try? Data(contentsOf: settingsURL) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func initialFrame(_ saved: [String: Any]?) -> NSRect {
        let width = config.baseWidth * scale
        let height = config.baseHeight * scale
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: width, height: height)
        let fallback = NSRect(x: screen.maxX - width - 28, y: screen.minY + 28, width: width, height: height)
        guard let x = (saved?["x"] as? NSNumber)?.doubleValue,
              let y = (saved?["y"] as? NSNumber)?.doubleValue else { return fallback }
        let restored = NSRect(x: x, y: y, width: width, height: height)
        let reachable = NSScreen.screens.contains { candidate in
            let intersection = candidate.frame.intersection(restored)
            return !intersection.isNull && intersection.width >= min(48, width) && intersection.height >= min(48, height)
        }
        return reachable ? restored : fallback
    }

    private func saveSettings() {
        let value: [String: Any] = ["scale": scale, "x": panel.frame.minX, "y": panel.frame.minY]
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        try? data.write(to: settingsURL, options: .atomic)
    }
}

private final class PetAppDelegate: NSObject, NSApplicationDelegate {
    private let launch: () throws -> PetHost
    private var host: PetHost?

    init(launch: @escaping () throws -> PetHost) { self.launch = launch }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.prohibited)
        do {
            host = try launch()
        } catch {
            FileHandle.standardError.write(Data("[border-collie] \(error.localizedDescription)\n".utf8))
            NSApp.terminate(nil)
        }
    }
}

@main
struct PetHostMain {
    static func main() {
        let environment = ProcessInfo.processInfo.environment
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
        let petDirectory = URL(fileURLWithPath: argument("pet-dir") ?? executable.deletingLastPathComponent().deletingLastPathComponent().path)
        let dataDirectory = URL(fileURLWithPath: argument("data-dir") ?? environment["BORDER_COLLIE_DATA_DIR"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".border-collie").path)
        let eventURL = URL(fileURLWithPath: argument("events") ?? environment["BORDER_COLLIE_EVENTS"] ?? dataDirectory.appendingPathComponent("events.jsonl").path)
        let eventOffset = UInt64(environment["BORDER_COLLIE_EVENT_OFFSET"] ?? "")
        let ownerPID = Int32(argument("owner-pid") ?? environment["BORDER_COLLIE_OWNER_PID"] ?? "")
        let shortcut = argument("shortcut") ?? "Control+Alt+R"
        do {
            try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
            let owners = try OwnerRegistry(dataDirectory: dataDirectory, ownerPID: ownerPID)
            if !owners.acquire() { exit(0) }
            let config = try loadPetConfig(at: petDirectory)
            let delegate = PetAppDelegate {
                let host = PetHost(petDirectory: petDirectory, dataDirectory: dataDirectory, eventURL: eventURL, eventOffset: eventOffset, owners: owners, config: config)
                try host.start(shortcut: shortcut)
                return host
            }
            let app = NSApplication.shared
            app.delegate = delegate
            app.run()
        } catch {
            FileHandle.standardError.write(Data("[border-collie] \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}
