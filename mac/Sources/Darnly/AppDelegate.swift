import AppKit
import SwiftUI
import DarnlyCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotkey: Hotkey?
    private let picker = Picker()
    private let notePanel = NotePanel()
    private let welcome = WelcomeWindow()
    private var busy = false
    private var frozen: Screenshot.Frozen?
    private let popover = NSPopover()
    private let panel = PanelModel()
    private var menu = NSMenu()

    private var projectURL: URL? {
        get { UserDefaults.standard.string(forKey: "projectPath").map { URL(fileURLWithPath: $0, isDirectory: true) } }
        set { UserDefaults.standard.set(newValue?.path, forKey: "projectPath"); rebuildMenu(); welcome.refresh() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = Brand.logo()
            // Left click opens the panel; right click (or Control-click) shows the plain menu.
            button.target = self
            button.action = #selector(statusClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        setUpPanel()
        rebuildMenu()
        hotkey = Hotkey { [weak self] in self?.capture() }
        // First launch: the welcome screen walks through the folder, the two permissions and the hotkey.
        if !UserDefaults.standard.bool(forKey: "welcomeShown") { showWelcome() }
        else if Destination.current == .folder && projectURL == nil { chooseProject() }
        else if Destination.current == .folder, let folder = projectURL { offerAgentSetup(folder) }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let cap = NSMenuItem(title: "Capture a bug", action: #selector(captureFromMenu), keyEquivalent: "d")
        cap.keyEquivalentModifierMask = [.option, .shift]
        cap.target = self
        menu.addItem(cap)
        menu.addItem(.separator())
        let cloud = CloudAccount.shared
        let header = NSMenuItem(title: "Bugs go to", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        let folder = item(projectURL.map { "Project folder: \($0.lastPathComponent)" } ?? "Project folder on this Mac", #selector(useFolder))
        folder.state = Destination.current == .folder ? .on : .off
        menu.addItem(folder)
        let inbox = item(cloud.email.map { "Cloud inbox: \($0)" } ?? "Cloud inbox (for cloud agents)", #selector(useCloud))
        inbox.state = Destination.current == .cloud ? .on : .off
        menu.addItem(inbox)
        menu.addItem(.separator())
        menu.addItem(item("Choose project folder…", #selector(chooseProject)))
        if projectURL != nil { menu.addItem(item("Set up coding agent in this folder…", #selector(setUpAgentFromMenu))) }
        menu.addItem(item("Open inbox in Finder", #selector(openInbox)))
        if cloud.isSignedIn { menu.addItem(item("Sign out of cloud inbox", #selector(signOutCloud))) }
        menu.addItem(.separator())
        menu.addItem(item("How to use Darnly…", #selector(showWelcome)))
        menu.addItem(item("Permissions…", #selector(openPermissions)))
        menu.addItem(item("Quit Darnly", #selector(NSApplication.terminate(_:)), target: NSApp))
        self.menu = menu
        refreshPanel()
    }

    // MARK: The menu bar panel

    private func setUpPanel() {
        popover.behavior = .transient
        popover.appearance = Brand.appearance
        popover.contentViewController = NSHostingController(rootView: PanelView(model: panel))
        panel.capture = { [weak self] in
            self?.popover.performClose(nil)
            // Let the panel fade out first so it isn't in the screenshot.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self?.capture() }
        }
        panel.useFolder = { [weak self] in self?.useFolder() }
        panel.useCloud = { [weak self] in self?.popover.performClose(nil); self?.useCloud() }
        panel.chooseFolder = { [weak self] in self?.popover.performClose(nil); self?.chooseProject() }
        panel.setUpAgent = { [weak self] in self?.setUpAgent() }
        panel.openInbox = { [weak self] in self?.popover.performClose(nil); self?.openInbox() }
        panel.openBug = { [weak self] bug in
            guard let file = bug.file else { return }
            self?.popover.performClose(nil)
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: file)])
        }
        panel.showHelp = { [weak self] in self?.popover.performClose(nil); self?.showWelcome() }
        panel.showMore = { [weak self] in self?.popover.performClose(nil); self?.showMenu() }
        panel.quit = { NSApp.terminate(nil) }
    }

    @objc private func statusClicked() {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true { return showMenu() }
        togglePanel()
    }

    private func togglePanel() {
        guard let button = statusItem.button else { return }
        if popover.isShown { return popover.performClose(nil) }
        refreshPanel()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    /// The plain menu, for right click and the panel's "…" button.
    private func showMenu() {
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    private var recentBugs: [RecentBug] {
        get { RecentBugs.decode(UserDefaults.standard.data(forKey: "recentBugs")) }
        set { UserDefaults.standard.set(RecentBugs.encode(newValue), forKey: "recentBugs") }
    }

    private func remember(_ bug: RecentBug) {
        recentBugs = RecentBugs.adding(bug, to: recentBugs)
        refreshPanel()
    }

    private func refreshPanel() {
        let folder = projectURL
        panel.destination = Destination.current
        panel.folderName = folder?.lastPathComponent
        panel.cloudEmail = CloudAccount.shared.isSignedIn ? CloudAccount.shared.email : nil
        panel.agentReady = folder.map { AgentSetup.plan(folder: $0, project: $0.lastPathComponent).isEmpty }
        panel.waiting = folder.map { Inbox.waiting(project: $0) } ?? 0
        panel.recent = recentBugs.map { ($0, RecentBugs.state(of: $0)) }
        if !Probe.isTrusted(prompt: false) {
            panel.notice = .init(text: "Allow Accessibility so Darnly knows what you clicked.", button: "Allow") { [weak self] in
                self?.popover.performClose(nil)
                self?.openPermissions()
            }
        } else {
            panel.notice = nil
        }
    }

    private func item(_ title: String, _ action: Selector, target: AnyObject? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = target ?? self
        return i
    }

    @objc private func captureFromMenu() { capture() }

    @objc private func showWelcome() {
        welcome.show(project: { [weak self] in self?.projectURL }, chooseProject: { [weak self] in self?.chooseProject() }, signIn: { [weak self] in self?.signInCloud() },
                     setUpAgent: { [weak self] in self?.setUpAgent() }, changed: { [weak self] in self?.rebuildMenu() })
    }

    @objc private func useFolder() {
        Destination.current = .folder
        rebuildMenu()
        welcome.refresh()
        if projectURL == nil { chooseProject() }
    }

    @objc private func useCloud() {
        if CloudAccount.shared.isSignedIn {
            Destination.current = .cloud
            rebuildMenu()
            welcome.refresh()
        } else {
            signInCloud()
        }
    }

    /// Sign in to the cloud inbox; on success, captures go there.
    func signInCloud() {
        CloudAccount.shared.signIn { [weak self] problem in
            guard let self else { return }
            if let problem {
                self.notify(problem)
            } else {
                Destination.current = .cloud
                self.notify("Signed in as \(CloudAccount.shared.email ?? "you"). Bugs now go to your Darnly cloud inbox.")
            }
            self.rebuildMenu()
            self.welcome.refresh()
        }
    }

    @objc private func signOutCloud() {
        CloudAccount.shared.signOut()
        Destination.current = .folder
        rebuildMenu()
        welcome.refresh()
    }

    /// Where bugs are saved when there's no project folder (for example a cloud upload failed): ~/Darnly/.darnly/inbox.
    private var fallbackFolder: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Darnly", isDirectory: true)
    }

    @objc private func chooseProject() {
        let panel = NSOpenPanel()
        panel.message = "Choose your project's folder. Bugs are saved into .darnly/inbox inside it, where your coding agent finds them."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Use this folder"
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, let url = panel.url {
            projectURL = url
            offerAgentSetup(url)
        }
    }

    // MARK: Agent setup (the same files the Chrome extension writes)

    /// Asks once per folder whether to tell the coding agent about .darnly/inbox. Nothing is asked when it already knows.
    private func offerAgentSetup(_ folder: URL) {
        let plan = AgentSetup.plan(folder: folder, project: folder.lastPathComponent)
        guard !plan.isEmpty else { return }
        var asked = UserDefaults.standard.stringArray(forKey: "agentSetupAsked") ?? []
        guard !asked.contains(folder.path) else { return }
        asked.append(folder.path)
        UserDefaults.standard.set(asked, forKey: "agentSetupAsked")
        let alert = NSAlert()
        alert.messageText = "Tell your coding agent where the bugs are?"
        alert.informativeText = """
        Darnly adds a short note to AGENTS.md, a /darnly command for Claude Code, Codex and Cursor, and two Claude Code hooks that mention new bugs. Your own text in these files is kept.

        \(plan.map { ($0.isNew ? "New: " : "Updated: ") + $0.path }.joined(separator: "\n"))
        """
        alert.addButton(withTitle: "Set up")
        alert.addButton(withTitle: "Not now")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { setUpAgent() }
    }

    @objc private func setUpAgentFromMenu() { setUpAgent() }

    private func setUpAgent() {
        guard let folder = projectURL else { return chooseProject() }
        let plan = AgentSetup.plan(folder: folder, project: folder.lastPathComponent)
        guard !plan.isEmpty else { return notify("Your agent already knows about \(Report.inboxFolder) in \(folder.lastPathComponent). Type /darnly to fix bugs.") }
        do {
            try AgentSetup.apply(plan, in: folder)
            notify("Set up \(folder.lastPathComponent): your agent now finds bugs in \(Report.inboxFolder). Type /darnly to fix them.")
        } catch {
            notify("Couldn't set up the agent: \(error.localizedDescription)")
        }
        welcome.refresh()
        refreshPanel()
    }

    // MARK: Cloud project names

    /// The name the user's cloud bugs from this app go under: saved once per app, renamable in the note box.
    private func cloudProject(for app: String, bundleId: String?) -> String {
        let saved = (UserDefaults.standard.dictionary(forKey: "appProject") as? [String: String])?[bundleId ?? app]
        return ProjectName.suggest(saved: saved, folder: projectURL, appName: app)
    }

    private func saveCloudProject(_ name: String, for app: String, bundleId: String?) {
        let clean = ProjectName.clean(name)
        guard !clean.isEmpty else { return }
        var all = UserDefaults.standard.dictionary(forKey: "appProject") as? [String: String] ?? [:]
        all[bundleId ?? app] = clean
        UserDefaults.standard.set(all, forKey: "appProject")
    }

    @objc private func openInbox() {
        guard let p = projectURL ?? (Destination.current == .cloud ? fallbackFolder : nil) else { return chooseProject() }
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
        let project = projectURL
        if Destination.current == .cloud {
            guard CloudAccount.shared.isSignedIn else { return signInCloud() }
        } else if project == nil {
            return chooseProject()
        }
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
    private func finish(_ pick: Pick, project: URL?) async {
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
        let bundleId = NSRunningApplication(processIdentifier: window.pid)?.bundleIdentifier
        let cloudGuess = Destination.current == .cloud ? cloudProject(for: window.ownerName, bundleId: bundleId) : nil
        let summary = element.map { "\($0.roleDescription ?? $0.role) \"\($0.name)\" in \(window.ownerName)" } ?? "Whole window: \(window.ownerName)"
        let result: NoteResult? = await withCheckedContinuation { cont in
            notePanel.show(image: preview, summary: hiddenReason != nil ? summary + " · no picture: this window hides itself from screenshots" : png == nil ? summary + " · no screenshot (allow Screen Recording)" : summary,
                           project: cloudGuess) { cont.resume(returning: $0) }
        }
        guard let result else { return }
        let note = result.note
        let collected = await logs
        let now = Date()
        let title = Report.title(note: note, element: element)
        let capture = NativeCapture(
            id: captureId(now, title), note: note, platform: collected.platform, appName: window.ownerName,
            bundleId: collected.bundleId ?? bundleId,
            windowTitle: window.title, device: collected.device, windowSize: window.frame.size, capturedAt: now,
            element: element, logs: collected.logs, logsRead: collected.read, noScreenshotReason: hiddenReason, hasReference: result.reference != nil)
        var problem = ""
        if Destination.current == .cloud {
            var forCloud = capture
            forCloud.forCloud = true
            let sendProject = ProjectName.clean(result.project ?? "").isEmpty ? cloudGuess : result.project
            if let sendProject { saveCloudProject(sendProject, for: window.ownerName, bundleId: bundleId) }
            let parts = Cloud.uploadParts(title: title, appName: window.ownerName, project: sendProject, markdown: Report.markdown(forCloud), png: png, reference: result.reference)
            do {
                try await CloudAccount.shared.upload(parts)
                remember(RecentBug(title: title, app: window.ownerName, date: now, project: ProjectName.clean(sendProject ?? "my-app")))
                notify("Sent to your Darnly cloud inbox under \(ProjectName.clean(sendProject ?? "my-app")). Tell your agent: fix the bugs in my Darnly inbox")
                return
            } catch let e as CloudError {
                problem = e.message + " "
                rebuildMenu()
            } catch {
                problem = "Couldn't reach the cloud inbox (\(error.localizedDescription)). "
            }
        }
        // The project folder, or ~/Darnly when the cloud upload failed and there's no folder: the bug is never lost.
        let folder = project ?? fallbackFolder
        do {
            let file = try Inbox.save(project: folder, id: capture.id, markdown: Report.markdown(capture), png: png, reference: result.reference, logs: capture.logs)
            remember(RecentBug(title: title, app: window.ownerName, date: now, file: file.path))
            let shown = folder == project ? Report.inboxFolder : "~/Darnly/\(Report.inboxFolder)"
            notify(problem + "Saved to \(shown)/\(file.lastPathComponent)." + (problem.isEmpty ? " Tell your agent: fix the bugs in \(Report.inboxFolder)" : ""))
        } catch {
            notify(problem + "Couldn't save: \(error.localizedDescription)")
        }
    }

    private func notify(_ text: String) {
        // A short-lived note under the menu bar icon, in Darnly's colours.
        guard let button = statusItem.button else { return }
        let pop = NSPopover()
        pop.behavior = .transient
        pop.appearance = Brand.appearance
        let icon = NSImageView(image: Brand.logo(size: 20, template: false))
        icon.setContentHuggingPriority(.required, for: .horizontal)
        let label = NSTextField(wrappingLabelWithString: text)
        label.textColor = Brand.ink
        label.font = .systemFont(ofSize: 13)
        label.preferredMaxLayoutWidth = 280
        let row = NSStackView(views: [icon, label])
        row.alignment = .top
        row.spacing = 10
        row.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 14)
        let vc = NSViewController()
        vc.view = row
        pop.contentViewController = vc
        pop.contentSize = row.fittingSize
        pop.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { pop.close() }
    }
}
