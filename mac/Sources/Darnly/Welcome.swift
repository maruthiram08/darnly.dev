import AppKit
import SwiftUI
import DarnlyCore

/// What the welcome screen shows and can do. The app delegate owns the real actions.
final class WelcomeModel: ObservableObject {
    @Published var projectName: String?
    @Published var accessibility = false
    @Published var screenRecording = false
    @Published var destination = Destination.current
    @Published var cloudEmail: String?
    /// Whether the project's agent already knows about .darnly/inbox (nil: no folder yet).
    @Published var agentReady: Bool?
    let chooseProject: () -> Void
    let signIn: () -> Void
    let setUpAgent: () -> Void
    private let changed: () -> Void
    private var timer: Timer?
    private let project: () -> URL?

    /// False for `--snapshot` pictures: a fixed state, nothing read from this Mac.
    private let live: Bool

    init(project: @escaping () -> URL?, chooseProject: @escaping () -> Void, signIn: @escaping () -> Void, setUpAgent: @escaping () -> Void, changed: @escaping () -> Void, live: Bool = true) {
        self.project = project
        self.chooseProject = chooseProject
        self.signIn = signIn
        self.setUpAgent = setUpAgent
        self.changed = changed
        self.live = live
        guard live else { return }
        refresh()
        // Permissions change in System Settings, outside the app: keep the ticks current while the window is open.
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func stop() { timer?.invalidate(); timer = nil }

    /// The welcome screen half set up, for `--snapshot`: folder chosen (or signed in), Accessibility allowed, Screen Recording not yet.
    static func sample(cloud: Bool) -> WelcomeModel {
        let m = WelcomeModel(project: { nil }, chooseProject: {}, signIn: {}, setUpAgent: {}, changed: {}, live: false)
        m.projectName = "my-app"
        m.agentReady = true
        m.accessibility = true
        m.screenRecording = false
        m.destination = cloud ? .cloud : .folder
        m.cloudEmail = cloud ? "you@example.com" : nil
        return m
    }

    func refresh() {
        guard live else { return }
        let folder = project()
        projectName = folder?.lastPathComponent
        agentReady = folder.map { AgentSetup.plan(folder: $0, project: $0.lastPathComponent).isEmpty }
        accessibility = Probe.isTrusted(prompt: false)
        screenRecording = CGPreflightScreenCaptureAccess()
        cloudEmail = CloudAccount.shared.isSignedIn ? CloudAccount.shared.email : nil
        if cloudEmail != nil { pendingCloud = false }
        destination = pendingCloud ? .cloud : Destination.current
    }

    /// "In the cloud" picked, not signed in yet: keep showing the sign-in button.
    private var pendingCloud = false

    /// The choice in step 1. Cloud only sticks once signed in; until then the sign-in button is shown.
    func choose(_ d: Destination) {
        destination = d
        pendingCloud = d == .cloud && cloudEmail == nil
        if !pendingCloud { Destination.current = d; changed() }
    }

    var ready: Bool { destination == .folder ? projectName != nil : cloudEmail != nil }

    func allowAccessibility() {
        _ = Probe.isTrusted(prompt: true)
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }

    func allowScreenRecording() {
        // Shows macOS's own prompt the first time; after that, only System Settings can change it.
        if !CGRequestScreenCaptureAccess() {
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        }
    }
}

struct WelcomeView: View {
    @ObservedObject var model: WelcomeModel
    let done: () -> Void
    @State private var copied = false
    private var agentPrompt: String {
        if model.destination == .cloud { return "fix the bugs in my Darnly inbox" }
        return model.agentReady == true ? "/darnly" : "fix the bugs in \(Report.inboxFolder)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 52, height: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Welcome to Darnly").font(.system(size: 22, weight: .bold)).foregroundStyle(Color.ink)
                    Text("Show your coding agent a bug instead of describing it. Darnly saves a marked screenshot, the exact element and recent errors where Claude Code, Codex or Cursor can read them.")
                        .font(.callout)
                        .foregroundStyle(Color.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.bottom, 4)

            step(1, "Where does your coding agent run?", done: model.ready) {
                VStack(alignment: .leading, spacing: 10) {
                    SwiftUI.Picker("", selection: Binding(get: { model.destination }, set: { model.choose($0) })) {
                        Text("On this Mac").tag(Destination.folder)
                        Text("In the cloud").tag(Destination.cloud)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 260)
                    if model.destination == .folder {
                        HStack {
                            if let name = model.projectName {
                                Text("Saving bugs into **\(name)**/\(Report.inboxFolder)").foregroundStyle(Color.inkSoft)
                            } else {
                                Text("Pick the folder with your app's code. Bugs go into .darnly/inbox inside it.").foregroundStyle(Color.inkSoft)
                            }
                            Spacer()
                            Button(model.projectName == nil ? "Choose folder…" : "Change…") { model.chooseProject() }
                        }
                        if let ready = model.agentReady {
                            HStack(spacing: 6) {
                                Image(systemName: ready ? "checkmark.circle.fill" : "sparkles").foregroundStyle(ready ? Color.sky : Color.pink)
                                Text(ready ? "Your agent knows where to look (AGENTS.md, /darnly, Claude Code hooks)." : "Tell your agent where the bugs are: adds AGENTS.md, /darnly and Claude Code hooks.")
                                    .font(.callout).foregroundStyle(Color.inkSoft)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer()
                                if !ready { Button("Set up agent") { model.setUpAgent() } }
                            }
                        }
                    } else {
                        HStack {
                            Group {
                                if let email = model.cloudEmail {
                                    Text("Signed in as **\(email)**. Bugs go to your private Darnly inbox.")
                                } else {
                                    Text("Claude, Codex or Cursor online: sign in once, then add the Darnly connector (api.darnly.dev/mcp) in your agent.")
                                }
                            }
                            .foregroundStyle(Color.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                            Spacer()
                            if model.cloudEmail == nil { Button("Sign in with Google…") { model.signIn() }.buttonStyle(BrandButtonStyle()) }
                        }
                    }
                }
            }

            step(2, "Allow two permissions", done: model.accessibility && model.screenRecording) {
                VStack(alignment: .leading, spacing: 8) {
                    permission("Accessibility", "to know which button or text you clicked", allowed: model.accessibility, action: model.allowAccessibility)
                    permission("Screen Recording", "for the screenshot", allowed: model.screenRecording, action: model.allowScreenRecording)
                    Text("macOS may ask you to quit and reopen Darnly after allowing Screen Recording.")
                        .font(.caption).foregroundStyle(Color.inkSoft.opacity(0.8))
                }
            }

            step(3, "Capture a bug", done: nil) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        Text("Press")
                        key("⌥"); key("⇧"); key("D")
                        Text("in any app, the iOS Simulator or the Android Emulator.")
                    }
                    Text("Click the broken part. **↑ / ↓** make the box bigger or smaller, **W** takes the whole window, **Esc** cancels.")
                    Text("Type what you expected and press **Enter**. Got a picture of how it should look? Paste or drop it into the note.")
                }
                .foregroundStyle(Color.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            }

            step(4, "Ask your agent to fix it", done: nil) {
                HStack(spacing: 10) {
                    Text(model.destination == .cloud ? "In your agent, say" : "In your agent, in that project, type").foregroundStyle(Color.inkSoft)
                    Text(agentPrompt)
                        .font(.system(.body, design: .monospaced))
                        .fixedSize()
                        .foregroundStyle(Color.ink)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.wash))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.line))
                    Spacer()
                    Button(copied ? "Copied" : "Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(agentPrompt, forType: .string)
                        copied = true
                    }
                }
            }

            HStack {
                Image(systemName: "ladybug.fill").foregroundStyle(Color.pink)
                Text("Darnly lives in the menu bar. Reopen this from its menu: How to use Darnly.")
                    .font(.caption).foregroundStyle(Color.inkSoft)
                Spacer()
                Button("Start using Darnly", action: done)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(BrandButtonStyle())
            }
            .padding(.top, 4)
        }
        .padding(24)
        .frame(width: 580)
        .background(Color.page)
        .tint(.sky)
        .environment(\.colorScheme, .light)
    }

    private func step<Content: View>(_ n: Int, _ title: String, done: Bool?, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(done == true ? Color.sky : Color.wash).frame(width: 28, height: 28)
                Circle().stroke(done == true ? Color.sky : Color.line, lineWidth: 1).frame(width: 28, height: 28)
                if done == true {
                    Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white)
                } else {
                    Text("\(n)").font(.callout.bold()).foregroundStyle(Color.skyDeep)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.headline).foregroundStyle(Color.ink)
                content()
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.line))
    }

    private func key(_ k: String) -> some View {
        Text(k)
            .font(.system(.callout, design: .rounded).bold())
            .foregroundStyle(Color.ink)
            .frame(minWidth: 22, minHeight: 22)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color.wash))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.line))
    }

    private func permission(_ name: String, _ why: String, allowed: Bool, action: @escaping () -> Void) -> some View {
        HStack {
            Image(systemName: allowed ? "checkmark.circle.fill" : "circle").foregroundStyle(allowed ? Color.sky : Color.inkSoft.opacity(0.6))
            Text("**\(name)** \(why)").foregroundStyle(Color.inkSoft)
            Spacer()
            if !allowed { Button("Allow…", action: action) }
        }
    }
}

/// The welcome window: shown on first launch and from the menu.
final class WelcomeWindow: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private var model: WelcomeModel?

    func show(project: @escaping () -> URL?, chooseProject: @escaping () -> Void, signIn: @escaping () -> Void, setUpAgent: @escaping () -> Void, changed: @escaping () -> Void) {
        if let window {
            model?.refresh()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let model = WelcomeModel(project: project, chooseProject: chooseProject, signIn: signIn, setUpAgent: setUpAgent, changed: changed)
        let view = WelcomeView(model: model) { [weak self] in self?.window?.close() }
        let w = NSWindow(contentViewController: NSHostingController(rootView: view))
        w.title = "Darnly"
        w.styleMask = [.titled, .closable]
        w.appearance = Brand.appearance
        w.backgroundColor = Brand.page
        w.isReleasedWhenClosed = false
        w.delegate = self
        w.center()
        self.window = w
        self.model = model
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func refresh() { model?.refresh() }

    func windowWillClose(_ notification: Notification) {
        UserDefaults.standard.set(true, forKey: "welcomeShown")
        model?.stop()
        model = nil
        window = nil
    }
}
