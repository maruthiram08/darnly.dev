import AppKit
import DarnlyCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotkey: Hotkey?
    private let picker = Picker()
    private let notePanel = NotePanel()
    private var busy = false
    private var frozen: Screenshot.Frozen?

    private var projectURL: URL? {
        get { UserDefaults.standard.string(forKey: "projectPath").map { URL(fileURLWithPath: $0, isDirectory: true) } }
        set { UserDefaults.standard.set(newValue?.path, forKey: "projectPath"); rebuildMenu() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "ladybug", accessibilityDescription: "Darnly")
            button.image?.isTemplate = true
        }
        rebuildMenu()
        hotkey = Hotkey { [weak self] in self?.capture() }
        // Ask for Accessibility once (to name the element under the click). Screen Recording is asked on the first capture.
        _ = Probe.isTrusted(prompt: true)
        if projectURL == nil { chooseProject() }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let cap = NSMenuItem(title: "Capture a bug", action: #selector(captureFromMenu), keyEquivalent: "d")
        cap.keyEquivalentModifierMask = [.option, .shift]
        cap.target = self
        menu.addItem(cap)
        menu.addItem(.separator())
        let project = NSMenuItem(title: projectURL.map { "Project: \($0.lastPathComponent)" } ?? "No project folder yet", action: nil, keyEquivalent: "")
        project.isEnabled = false
        menu.addItem(project)
        menu.addItem(item("Choose project folder…", #selector(chooseProject)))
        menu.addItem(item("Open inbox in Finder", #selector(openInbox)))
        menu.addItem(.separator())
        menu.addItem(item("Permissions…", #selector(openPermissions)))
        menu.addItem(item("Quit Darnly", #selector(NSApplication.terminate(_:)), target: NSApp))
        statusItem.menu = menu
    }

    private func item(_ title: String, _ action: Selector, target: AnyObject? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = target ?? self
        return i
    }

    @objc private func captureFromMenu() { capture() }

    @objc private func chooseProject() {
        let panel = NSOpenPanel()
        panel.message = "Choose your project's folder. Bugs are saved into .darnly/inbox inside it, where your coding agent finds them."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Use this folder"
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, let url = panel.url { projectURL = url }
    }

    @objc private func openInbox() {
        guard let p = projectURL else { return chooseProject() }
        let inbox = p.appendingPathComponent(Report.inboxFolder, isDirectory: true)
        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        NSWorkspace.shared.open(inbox)
    }

    @objc private func openPermissions() {
        let ax = Probe.isTrusted(prompt: false)
        let alert = NSAlert()
        alert.messageText = "Darnly needs two permissions"
        alert.informativeText = """
        Accessibility: \(ax ? "allowed" : "not allowed yet") (to know which button or text you clicked)
        Screen Recording: needed for the screenshot. macOS asks on the first capture.

        Open System Settings → Privacy & Security to change either one.
        """
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Close")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
        }
    }

    private func capture() {
        guard !busy else { return }
        guard let project = projectURL else { return chooseProject() }
        busy = true
        let mouse = NSEvent.mouseLocation
        Task { @MainActor in
            // Take the picture first: whatever is on screen right now, before the picker covers it.
            self.frozen = await Screenshot.freezeScreen(at: mouse)
            self.picker.start { [weak self] pick in
                guard let self else { return }
                guard let pick else { self.busy = false; self.frozen = nil; return }
                Task { @MainActor in await self.finish(pick, project: project) }
            }
        }
    }

    @MainActor
    private func finish(_ pick: Pick, project: URL) async {
        defer { busy = false }
        let window = pick.window
        let element = pick.element.flatMap { Probe.info($0, in: window) }
        async let logs = LogCollector.collect(for: window)
        var png: Data?
        var preview: NSImage?
        defer { frozen = nil }
        let hiddenReason = window.hiddenFromCapture ? "\(window.ownerName) hides this window from screenshots, so macOS doesn't let any app take a picture of it." : nil
        if hiddenReason == nil {
            do {
                // Prefer the picture taken when the hotkey was pressed; it still shows panels that hid since.
                let image: CGImage
                if let f = frozen, let cut = Screenshot.crop(f, to: window.frame) { image = cut } else { image = try await Screenshot.capture(window) }
                png = Screenshot.mark(image, windowSize: window.frame.size, box: element?.frame, click: element != nil ? pick.click : nil)
                if let png { preview = NSImage(data: png) }
            } catch {
                NSLog("Darnly: screenshot failed: \(error)")
            }
        }
        let summary = element.map { "\($0.roleDescription ?? $0.role) \"\($0.name)\" in \(window.ownerName)" } ?? "Whole window: \(window.ownerName)"
        let note: String? = await withCheckedContinuation { cont in
            notePanel.show(image: preview, summary: hiddenReason != nil ? summary + " · no picture: this window hides itself from screenshots" : png == nil ? summary + " · no screenshot (allow Screen Recording)" : summary) { cont.resume(returning: $0) }
        }
        guard let note else { return }
        let collected = await logs
        let now = Date()
        let title = Report.title(note: note, element: element)
        let capture = NativeCapture(
            id: captureId(now, title), note: note, platform: collected.platform, appName: window.ownerName,
            bundleId: collected.bundleId ?? NSRunningApplication(processIdentifier: window.pid)?.bundleIdentifier,
            windowTitle: window.title, device: collected.device, windowSize: window.frame.size, capturedAt: now,
            element: element, logs: collected.logs, logsRead: collected.read, noScreenshotReason: hiddenReason)
        do {
            let file = try Inbox.save(project: project, id: capture.id, markdown: Report.markdown(capture), png: png, logs: capture.logs)
            notify("Saved to \(Report.inboxFolder)/\(file.lastPathComponent). Tell your agent: fix the bugs in \(Report.inboxFolder)")
        } catch {
            notify("Couldn't save: \(error.localizedDescription)")
        }
    }

    private func notify(_ text: String) {
        // A short-lived note under the menu bar icon.
        guard let button = statusItem.button else { return }
        let pop = NSPopover()
        pop.behavior = .transient
        let label = NSTextField(wrappingLabelWithString: text)
        label.preferredMaxLayoutWidth = 300
        let vc = NSViewController()
        let box = NSView(frame: CGRect(x: 0, y: 0, width: 320, height: 64))
        label.frame = box.bounds.insetBy(dx: 10, dy: 10)
        box.addSubview(label)
        vc.view = box
        pop.contentViewController = vc
        pop.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { pop.close() }
    }
}
