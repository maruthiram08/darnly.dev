import AppKit

/// What the user picked: a window, and maybe one element in it.
struct Pick {
    let window: TargetWindow
    let element: AXUIElement?
    /// Where they clicked, in window points (top-left origin).
    let click: CGPoint?
}

/// A see-through overlay on the screen under the mouse. Hover shows what would be captured;
/// click picks it, Up/Down make the box bigger or smaller, W takes the whole window, Esc cancels.
final class Picker: NSObject {
    private var panel: NSPanel?
    private var view: PickerView?
    private var completion: ((Pick?) -> Void)?
    private var hoverWindow: TargetWindow?
    private var stack: [AXUIElement] = [] // stack.last is the boxed element; Up adds parents
    private var lastPoint = CGPoint.zero

    func start(completion: @escaping (Pick?) -> Void) {
        self.completion = completion
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main!
        let panel = KeyPanel(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.level = .screenSaver
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = false
        panel.acceptsMouseMovedEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let view = PickerView(frame: CGRect(origin: .zero, size: screen.frame.size))
        view.screenFrame = screen.frame
        view.onMove = { [weak self] p in self?.hover(p) }
        view.onClick = { [weak self] in self?.finish(whole: false) }
        view.onKey = { [weak self] key in self?.key(key) }
        panel.contentView = view
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(view)
        NSApp.activate(ignoringOtherApps: true)
        self.panel = panel
        self.view = view
        hover(Probe.topLeft(mouse))
    }

    private func hover(_ p: CGPoint) {
        lastPoint = p
        hoverWindow = Probe.window(at: p)
        stack = []
        if let w = hoverWindow, let el = Probe.element(pid: w.pid, at: p) { stack = [el] }
        redraw()
    }

    private func redraw() {
        guard let view else { return }
        if let el = stack.last, let f = Probe.frame(of: el) { view.box = f } else { view.box = hoverWindow?.frame }
        view.needsDisplay = true
    }

    private func key(_ key: PickerView.Key) {
        switch key {
        case .escape: close(nil)
        case .whole: finish(whole: true)
        case .enter: finish(whole: false)
        case .bigger:
            if let el = stack.last, let parent = Probe.parent(of: el) { stack.append(parent); redraw() }
        case .smaller:
            if stack.count > 1 { stack.removeLast(); redraw() }
        }
    }

    private func finish(whole: Bool) {
        guard let w = hoverWindow else { return close(nil) }
        let click = CGPoint(x: lastPoint.x - w.frame.minX, y: lastPoint.y - w.frame.minY)
        close(Pick(window: w, element: whole ? nil : stack.last, click: whole ? nil : click))
    }

    private func close(_ pick: Pick?) {
        panel?.orderOut(nil)
        panel = nil
        view = nil
        let done = completion
        completion = nil
        done?(pick)
    }
}

/// Borderless panels can't take key presses unless they say so.
final class KeyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

final class PickerView: NSView {
    enum Key { case escape, whole, enter, bigger, smaller }
    var screenFrame = CGRect.zero
    /// Global, top-left origin.
    var box: CGRect?
    var onMove: ((CGPoint) -> Void)?
    var onClick: (() -> Void)?
    var onKey: ((Key) -> Void)?

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self))
    }

    override func mouseMoved(with event: NSEvent) { onMove?(Probe.topLeft(NSEvent.mouseLocation)) }
    override func mouseDown(with event: NSEvent) {
        onMove?(Probe.topLeft(NSEvent.mouseLocation))
        onClick?()
    }

    override func keyDown(with event: NSEvent) {
        switch Int(event.keyCode) {
        case 53: onKey?(.escape)
        case 13: onKey?(.whole) // W
        case 36, 76: onKey?(.enter)
        case 126: onKey?(.bigger)
        case 125: onKey?(.smaller)
        default: super.keyDown(with: event)
        }
    }

    /// Global top-left rect -> this view's coordinates.
    private func local(_ r: CGRect) -> CGRect {
        let bottomLeftY = Probe.primaryHeight - r.maxY
        return CGRect(x: r.minX - screenFrame.minX, y: bottomLeftY - screenFrame.minY, width: r.width, height: r.height)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0, alpha: 0.08).setFill()
        bounds.fill()
        if let box {
            let r = local(box)
            NSColor(calibratedRed: 0.88, green: 0.11, blue: 0.28, alpha: 0.12).setFill()
            r.fill()
            let path = NSBezierPath(rect: r.insetBy(dx: -1, dy: -1))
            path.lineWidth = 2
            NSColor(calibratedRed: 0.88, green: 0.11, blue: 0.28, alpha: 1).setStroke()
            path.stroke()
        }
        let hint = "Click the broken part · ↑ ↓ bigger or smaller · W for the whole window · Esc to cancel" as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.white]
        let size = hint.size(withAttributes: attrs)
        let pill = CGRect(x: (bounds.width - size.width) / 2 - 14, y: bounds.height - 70, width: size.width + 28, height: size.height + 14)
        NSColor(calibratedRed: 0.08, green: 0.13, blue: 0.17, alpha: 0.92).setFill()
        NSBezierPath(roundedRect: pill, xRadius: pill.height / 2, yRadius: pill.height / 2).fill()
        hint.draw(at: CGPoint(x: pill.minX + 14, y: pill.minY + 7), withAttributes: attrs)
    }
}
