import AppKit
import ApplicationServices
import DarnlyCore

/// A window of another app, as the window server sees it. Frames are in global points, top-left origin.
struct TargetWindow {
    let id: CGWindowID
    let pid: pid_t
    let ownerName: String
    let title: String?
    let frame: CGRect
    /// The app asked macOS to keep this window out of screenshots (NSWindow.sharingType = .none).
    /// No capture API can see it; pictures show whatever is behind it instead.
    let hiddenFromCapture: Bool
}

enum Probe {
    /// Height of the main display, to turn AppKit's bottom-left coordinates into top-left ones.
    static var primaryHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }

    static func topLeft(_ p: NSPoint) -> CGPoint { CGPoint(x: p.x, y: primaryHeight - p.y) }

    /// Window server layers we look through: normal windows (0) up to pop-up menus, which covers
    /// floating panels, menu bar extras and notch apps. Darnly's own overlay sits far above these.
    static let maxLayer = Int(CGWindowLevelForKey(.popUpMenuWindow))
    /// System-owned windows that are never what the user means (the menu bar itself, the Dock, wallpaper).
    static let systemOwners: Set<String> = ["Window Server", "Dock", "Wallpaper", "WindowManager"]

    /// The front-most window under a point, skipping Darnly's own windows. Besides normal windows this
    /// finds panels that float above them (menu bar and notch apps). A raised window only counts when
    /// the app reports something at that point, because notch apps often keep a large see-through window up.
    static func window(at point: CGPoint) -> TargetWindow? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        let me = ProcessInfo.processInfo.processIdentifier
        for info in list {
            guard let layer = info[kCGWindowLayer as String] as? Int, layer >= 0, layer <= maxLayer,
                  let pid = info[kCGWindowOwnerPID as String] as? pid_t, pid != me,
                  let id = info[kCGWindowNumber as String] as? CGWindowID,
                  let b = info[kCGWindowBounds as String] as? [String: CGFloat],
                  let frame = Optional(CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)),
                  frame.contains(point), frame.width > 20, frame.height > 20 else { continue }
            let owner = info[kCGWindowOwnerName as String] as? String ?? "App"
            if systemOwners.contains(owner) { continue }
            if let alpha = info[kCGWindowAlpha as String] as? Double, alpha < 0.05 { continue }
            if layer != 0, element(pid: pid, at: point) == nil { continue }
            return TargetWindow(id: id, pid: pid, ownerName: owner, title: info[kCGWindowName as String] as? String, frame: frame,
                                hiddenFromCapture: (info[kCGWindowSharingState as String] as? Int) == Int(CGWindowSharingType.none.rawValue))
        }
        return nil
    }

    static func attr<T>(_ el: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
        return value as? T
    }

    static func frame(of el: AXUIElement) -> CGRect? {
        var pos = CGPoint.zero, size = CGSize.zero
        guard let p: AXValue = attr(el, kAXPositionAttribute), let s: AXValue = attr(el, kAXSizeAttribute),
              AXValueGetValue(p, .cgPoint, &pos), AXValueGetValue(s, .cgSize, &size) else { return nil }
        return CGRect(origin: pos, size: size)
    }

    /// Asks the app itself which element is at this point (our overlay on top doesn't get in the way).
    static func element(pid: pid_t, at point: CGPoint) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        var el: AXUIElement?
        guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &el) == .success else { return nil }
        return el
    }

    static func parent(of el: AXUIElement) -> AXUIElement? {
        guard let p: AXUIElement = attr(el, kAXParentAttribute) else { return nil }
        let role: String? = attr(p, kAXRoleAttribute)
        // Stop at the window: bigger than that is the whole window (W).
        return role == kAXApplicationRole || role == kAXWindowRole ? nil : p
    }

    /// Short texts in the element and its first children, for searching the code.
    static func labels(_ el: AXUIElement, depth: Int = 2, into out: inout [String]) {
        guard out.count < 6 else { return }
        for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
            if let s: String = attr(el, key) {
                let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
                if (2...60).contains(t.count), !out.contains(t) { out.append(t) }
            }
        }
        guard depth > 0, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) else { return }
        for k in kids.prefix(12) { labels(k, depth: depth - 1, into: &out) }
    }

    static func info(_ el: AXUIElement, in window: TargetWindow) -> ElementInfo? {
        guard let f = frame(of: el) else { return nil }
        var texts: [String] = []
        labels(el, into: &texts)
        let raw: CFTypeRef? = attr(el, kAXValueAttribute)
        return ElementInfo(
            role: attr(el, kAXRoleAttribute) ?? "AXUnknown",
            roleDescription: attr(el, kAXRoleDescriptionAttribute),
            title: attr(el, kAXTitleAttribute),
            label: attr(el, kAXDescriptionAttribute),
            value: (raw as? String) ?? (raw as? NSNumber)?.stringValue,
            identifier: attr(el, "AXIdentifier"),
            frame: f.offsetBy(dx: -window.frame.minX, dy: -window.frame.minY),
            labels: texts
        )
    }

    static func isTrusted(prompt: Bool) -> Bool {
        AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary)
    }
}
