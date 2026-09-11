import ApplicationServices
import AppKit
import Foundation

func fail(_ message: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func number(_ value: String) -> Double {
    guard let parsed = Double(value) else { fail("invalid coordinate: \(value)") }
    return parsed
}

func eventSource() -> CGEventSource {
    guard AXIsProcessTrusted() else { fail("macOS Accessibility permission is required for native pointer acceptance", 2) }
    guard let source = CGEventSource(stateID: .hidSystemState) else { fail("could not create native event source") }
    return source
}

func postMouse(_ source: CGEventSource, _ type: CGEventType, _ point: CGPoint) {
    guard let event = CGEvent(
        mouseEventSource: source,
        mouseType: type,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else { fail("could not create native mouse event") }
    event.post(tap: .cghidEventTap)
}

func postShortcut(_ source: CGEventSource, _ keyCode: UInt16, _ flags: CGEventFlags) {
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true) else {
        fail("could not create shortcut key down")
    }
    down.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(30_000)
    guard let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
        fail("could not create shortcut key up")
    }
    up.flags = flags
    up.post(tap: .cghidEventTap)
}

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
    return attribute(element, name) as? String ?? ""
}

func elementCenter(_ element: AXUIElement) -> CGPoint? {
    guard let positionValue = attribute(element, kAXPositionAttribute as CFString) else { return nil }
    guard let sizeValue = attribute(element, kAXSizeAttribute as CFString) else { return nil }
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position) else { return nil }
    guard AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return nil }
    return CGPoint(x: position.x + size.width / 2, y: position.y + size.height / 2)
}

func findControl(_ element: AXUIElement, _ needle: String, _ depth: Int = 0) -> CGPoint? {
    if depth > 20 { return nil }
    let label = [
        stringAttribute(element, kAXTitleAttribute as CFString),
        stringAttribute(element, kAXDescriptionAttribute as CFString),
        stringAttribute(element, kAXHelpAttribute as CFString),
        stringAttribute(element, kAXValueAttribute as CFString),
    ].joined(separator: " ").lowercased()
    if label.contains(needle.lowercased()), let center = elementCenter(element) { return center }
    guard let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else { return nil }
    for child in children {
        if let point = findControl(child, needle, depth + 1) { return point }
    }
    return nil
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail("missing command") }

switch arguments[1] {
case "find":
    guard arguments.count == 3, let ownerPID = Int(arguments[2]) else { fail("find requires a process id") }
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        fail("could not list native windows")
    }
    let matches = windows.compactMap { window -> CGRect? in
        guard (window[kCGWindowOwnerPID as String] as? Int) == ownerPID else { return nil }
        guard let dictionary = window[kCGWindowBounds as String] else { return nil }
        guard let bounds = CGRect(dictionaryRepresentation: dictionary as! CFDictionary) else { return nil }
        return bounds.width >= 100 && bounds.height >= 100 ? bounds : nil
    }
    guard let bounds = matches.max(by: { $0.width * $0.height < $1.width * $1.height }) else { exit(3) }
    let output: [String: Double] = [
        "x": bounds.origin.x,
        "y": bounds.origin.y,
        "width": bounds.width,
        "height": bounds.height,
    ]
    let data = try JSONSerialization.data(withJSONObject: output)
    FileHandle.standardOutput.write(data)
case "click":
    guard arguments.count == 4 else { fail("click requires x and y") }
    let source = eventSource()
    let point = CGPoint(x: number(arguments[2]), y: number(arguments[3]))
    postMouse(source, .mouseMoved, point)
    usleep(150_000)
    postMouse(source, .leftMouseDown, point)
    usleep(30_000)
    postMouse(source, .leftMouseUp, point)
case "find-control":
    guard arguments.count == 4, let ownerPID = Int32(arguments[2]) else { fail("find-control requires a process id and label") }
    guard AXIsProcessTrusted() else { fail("macOS Accessibility permission is required for native control acceptance", 2) }
    let application = AXUIElementCreateApplication(ownerPID)
    guard let point = findControl(application, arguments[3]) else { exit(3) }
    let data = try JSONSerialization.data(withJSONObject: ["x": point.x, "y": point.y])
    FileHandle.standardOutput.write(data)
case "drag":
    guard arguments.count == 6 else { fail("drag requires start and end coordinates") }
    let source = eventSource()
    let start = CGPoint(x: number(arguments[2]), y: number(arguments[3]))
    let end = CGPoint(x: number(arguments[4]), y: number(arguments[5]))
    postMouse(source, .mouseMoved, start)
    usleep(150_000)
    postMouse(source, .leftMouseDown, start)
    for step in 1...12 {
        let ratio = CGFloat(step) / 12
        let point = CGPoint(
            x: start.x + (end.x - start.x) * ratio,
            y: start.y + (end.y - start.y) * ratio
        )
        postMouse(source, .leftMouseDragged, point)
        usleep(20_000)
    }
    postMouse(source, .leftMouseUp, end)
case "shortcut":
    guard arguments.count == 3, let keyCode = UInt16(arguments[2]) else { fail("shortcut requires a key code") }
    let source = eventSource()
    postShortcut(source, keyCode, [.maskControl, .maskAlternate, .maskShift])
case "frontmost":
    guard let application = NSWorkspace.shared.frontmostApplication else { exit(3) }
    FileHandle.standardOutput.write(Data(String(application.processIdentifier).utf8))
default:
    fail("unknown command: \(arguments[1])")
}
