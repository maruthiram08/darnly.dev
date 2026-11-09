import AppKit

/// What the user picked: a window, and maybe one element in it.
struct Pick {
    let window: TargetWindow
    let element: AXUIElement?
    /// More elements Shift+clicked for the same note (red boxes 2, 3, …).
    var also: [AXUIElement] = []
    /// Where they clicked, in window points (top-left origin).
    let click: CGPoint?
}

/// A see-through overlay on the screen under the mouse. Hover shows what would be captured;
/// click picks it, Shift+click marks one more and keeps picking, Up/Down make the box bigger or smaller,
/// W takes the whole window, Esc cancels.
final class Picker: NSObject {
    private var panel: NSPanel?
    private var view: PickerView?
    private var completion: ((Pick?) -> Void)?
    private var hoverWindow: TargetWindow?
    private var stack: [AXUIElement] = [] // stack.last is the boxed element; Up adds parents
    private var lastPoint = CGPoint.zero
    /// Elements marked with Shift+click, all in one window.
    private var marked: [(element: AXUIElement, window: TargetWindow)] = []
    /// Most elements one bug can mark, like the extension.
    static let maxMarked = 8
    private var keyMonitor: Any?
    private var localKeyMonitor: Any?

    func start(completion: @escaping (Pick?) -> Void) {
        self.completion = completion
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main!
        // Non-activating and never key: the app under the cursor stays active, so menu bar and notch
        // panels that hide when they lose focus stay open while you pick.
        let panel = NSPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.becomesKeyOnlyIfNeeded = true
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
        view.onClick = { [weak self] shift in shift ? self?.mark() : self?.finish(whole: false) }
        view.onKey = { [weak self] key in self?.key(key) }
        panel.contentView = view
        panel.orderFrontRegardless()
        // Keys arrive while another app is active, so listen globally (needs Accessibility, which Darnly has).
        keyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak view] e in view?.handle(e) }
        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak view] e in view?.handle(e) == true ? nil : e }
        marked = []
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
        view.marked = marked.compactMap { Probe.frame(of: $0.element) }
        view.needsDisplay = true
    }

    private func key(_ key: PickerView.Key) {
        switch key {
        case .escape: close(nil)
        case .whole: finish(whole: true)
        case .enter: marked.isEmpty ? finish(whole: false) : finishMarked()
        case .bigger:
            if let el = stack.last, let parent = Probe.parent(of: el) { stack.append(parent); redraw() }
        case .smaller:
            if stack.count > 1 { stack.removeLast(); redraw() }
        }
    }

    /// Shift+click: mark the boxed element (or unmark it if it's already marked) and keep picking.
    private func mark() {
        guard let w = hoverWindow, let el = stack.last else { return }
        // One window per bug: marks in another window would point at a different screenshot.
        if let first = marked.first, first.window.id != w.id { return NSSound.beep() }
        if let i = marked.firstIndex(where: { CFEqual($0.element, el) }) {
            marked.remove(at: i)
        } else if marked.count < Self.maxMarked {
            marked.append((el, w))
        } else {
            NSSound.beep()
        }
        redraw()
    }

    /// Enter after Shift+clicks: the marked elements are the bug.
    private func finishMarked() {
        guard let first = marked.first else { return close(nil) }
        close(Pick(window: first.window, element: first.element, also: marked.dropFirst().map(\.element), click: nil))
    }

    private func finish(whole: Bool) {
        guard let w = hoverWindow else { return close(nil) }
        let click = CGPoint(x: lastPoint.x - w.frame.minX, y: lastPoint.y - w.frame.minY)
        if whole { return close(Pick(window: w, element: nil, click: nil)) }
        // A plain click after Shift+clicks in the same window adds the clicked element as the last one.
        if let first = marked.first, first.window.id == w.id {
            var all = marked.map(\.element)
            if let el = stack.last, !all.contains(where: { CFEqual($0, el) }) { all.append(el) }
            return close(Pick(window: w, element: all[0], also: Array(all.dropFirst()), click: click))
        }
        close(Pick(window: w, element: stack.last, click: click))
    }

    private func close(_ pick: Pick?) {
        if let m = keyMonitor { NSEvent.removeMonitor(m) }
        if let m = localKeyMonitor { NSEvent.removeMonitor(m) }
        keyMonitor = nil
        localKeyMonitor = nil
        panel?.orderOut(nil)
        panel = nil
        view = nil
        marked = []
        let done = completion
        completion = nil
        done?(pick)
    }
}

final class PickerView: NSView {
    enum Key { case escape, whole, enter, bigger, smaller }
    var screenFrame = CGRect.zero
    /// Global, top-left origin.
    var box: CGRect?
    /// Boxes already marked with Shift+click, numbered on screen.
    var marked: [CGRect] = []
    var onMove: ((CGPoint) -> Void)?
    /// True when Shift was held.
    var onClick: ((Bool) -> Void)?
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
        onClick?(event.modifierFlags.contains(.shift))
    }

    /// Picker keys. Returns false for keys the picker doesn't use.
    @discardableResult
    func handle(_ event: NSEvent) -> Bool {
        switch Int(event.keyCode) {
        case 53: onKey?(.escape)
        case 13: onKey?(.whole) // W
        case 36, 76: onKey?(.enter)
        case 126: onKey?(.bigger)
        case 125: onKey?(.smaller)
        default: return false
        }
        return true
    }

    override func keyDown(with event: NSEvent) {
        if !handle(event) { super.keyDown(with: event) }
    }

    /// Global top-left rect -> this view's coordinates.
    private func local(_ r: CGRect) -> CGRect {
        let bottomLeftY = Probe.primaryHeight - r.maxY
        return CGRect(x: r.minX - screenFrame.minX, y: bottomLeftY - screenFrame.minY, width: r.width, height: r.height)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0, alpha: 0.08).setFill()
        bounds.fill()
        let red = NSColor(calibratedRed: 0.88, green: 0.11, blue: 0.28, alpha: 1)
        for (i, m) in marked.enumerated() {
            let r = local(m)
            red.withAlphaComponent(0.18).setFill()
            r.fill()
            let path = NSBezierPath(rect: r.insetBy(dx: -1, dy: -1))
            path.lineWidth = 3
            red.setStroke()
            path.stroke()
            let n = "\(i + 1)" as NSString
            let a: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .bold), .foregroundColor: NSColor.white]
            let sz = n.size(withAttributes: a)
            let tag = CGRect(x: r.minX - 1, y: r.maxY + 1, width: sz.width + 10, height: sz.height + 4)
            red.setFill()
            tag.fill()
            n.draw(at: CGPoint(x: tag.minX + 5, y: tag.minY + 2), withAttributes: a)
        }
        if let box {
            let r = local(box)
            NSColor(calibratedRed: 0.88, green: 0.11, blue: 0.28, alpha: 0.12).setFill()
            r.fill()
            let path = NSBezierPath(rect: r.insetBy(dx: -1, dy: -1))
            path.lineWidth = 2
            NSColor(calibratedRed: 0.88, green: 0.11, blue: 0.28, alpha: 1).setStroke()
            path.stroke()
        }
        let hint = (marked.isEmpty
            ? "Click the broken part · Shift+click to mark several · ↑ ↓ bigger or smaller · W for the whole window · Esc to cancel"
            : "\(marked.count) marked · Shift+click to mark more · click the last one, or press Enter when done · Esc to cancel") as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.white]
        let size = hint.size(withAttributes: attrs)
        let pill = CGRect(x: (bounds.width - size.width) / 2 - 14, y: bounds.height - 70, width: size.width + 28, height: size.height + 14)
        NSColor(calibratedRed: 0.08, green: 0.13, blue: 0.17, alpha: 0.92).setFill()
        NSBezierPath(roundedRect: pill, xRadius: pill.height / 2, yRadius: pill.height / 2).fill()
        hint.draw(at: CGPoint(x: pill.minX + 14, y: pill.minY + 7), withAttributes: attrs)
    }
}
