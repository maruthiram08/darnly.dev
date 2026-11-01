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
    let chooseProject: () -> Void
    let signIn: () -> Void
    private let changed: () -> Void
    private var timer: Timer?
    private let project: () -> URL?

    init(project: @escaping () -> URL?, chooseProject: @escaping () -> Void, signIn: @escaping () -> Void, changed: @escaping () -> Void) {
        self.project = project
        self.chooseProject = chooseProject
        self.signIn = signIn
        self.changed = changed
        refresh()
        // Permissions change in System Settings, outside the app: keep the ticks current while the window is open.
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func stop() { timer?.invalidate(); timer = nil }

    func refresh() {
        projectName = project()?.lastPathComponent
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
    private var agentPrompt: String { model.destination == .cloud ? "fix the bugs in my Darnly inbox" : "fix the bugs in \(Report.inboxFolder)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Welcome to Darnly").font(.title).bold()
                Text("Show your coding agent a bug instead of describing it. Darnly saves a marked screenshot, the exact element and recent errors where Claude Code, Codex or Cursor can read them.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            step(1, "Where does your coding agent run?", done: model.ready) {
                VStack(alignment: .leading, spacing: 8) {
                    SwiftUI.Picker("", selection: Binding(get: { model.destination }, set: { model.choose($0) })) {
                        Text("On this Mac").tag(Destination.folder)
                        Text("In the cloud").tag(Destination.cloud)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 260)
                    if model.destination == .folder {
                        HStack {
                            Text(model.projectName.map { "Saving bugs into \($0)/\(Report.inboxFolder)" } ?? "Pick the folder with your app's code. Bugs go into .darnly/inbox inside it.")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button(model.projectName == nil ? "Choose…" : "Change…") { model.chooseProject() }
                        }
                    } else {
                        HStack {
                            Text(model.cloudEmail.map { "Signed in as \($0). Bugs go to your private Darnly inbox." } ?? "Claude, Codex or Cursor online: sign in once, then add the Darnly connector (api.darnly.dev/mcp) in your agent.")
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer()
                            if model.cloudEmail == nil { Button("Sign in with Google…") { model.signIn() } }
                        }
                    }
                }
            }

            step(2, "Allow two permissions", done: model.accessibility && model.screenRecording) {
                VStack(alignment: .leading, spacing: 6) {
                    permission("Accessibility", "to know which button or text you clicked", allowed: model.accessibility, action: model.allowAccessibility)
                    permission("Screen Recording", "for the screenshot", allowed: model.screenRecording, action: model.allowScreenRecording)
                    Text("macOS may ask you to quit and reopen Darnly after allowing Screen Recording.")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }

            step(3, "Capture a bug", done: nil) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Press **⌥⇧D** (Option+Shift+D) in any app, the iOS Simulator or the Android Emulator.")
                    Text("Click the broken part. **↑ / ↓** make the box bigger or smaller, **W** takes the whole window, **Esc** cancels.")
                    Text("Type what you expected and press **Enter**. Got a picture of how it should look? Paste or drop it into the note.")
                }
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }

            step(4, "Ask your agent to fix it", done: nil) {
                HStack {
                    Text(model.destination == .cloud ? "In your agent, say:" : "In your agent, in that project, say:").foregroundStyle(.secondary)
                    Text("\u{201C}\(agentPrompt)\u{201D}").font(.system(.body, design: .monospaced))
                    Spacer()
                    Button(copied ? "Copied" : "Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(agentPrompt, forType: .string)
                        copied = true
                    }
                }
            }

            HStack {
                Text("Darnly lives in the menu bar (the ladybug). Reopen this from its menu: How to use Darnly.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Start using Darnly", action: done).keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 560)
    }

    private func step<Content: View>(_ n: Int, _ title: String, done: Bool?, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(done == true ? Color.green : Color.secondary.opacity(0.2)).frame(width: 26, height: 26)
                if done == true {
                    Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white)
                } else {
                    Text("\(n)").font(.callout.bold())
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline)
                content()
            }
        }
    }

    private func permission(_ name: String, _ why: String, allowed: Bool, action: @escaping () -> Void) -> some View {
        HStack {
            Image(systemName: allowed ? "checkmark.circle.fill" : "circle").foregroundStyle(allowed ? .green : .secondary)
            Text("**\(name)** \(why)").foregroundStyle(.secondary)
            Spacer()
            if !allowed { Button("Allow…", action: action) }
        }
    }
}

/// The welcome window: shown on first launch and from the menu.
final class WelcomeWindow: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private var model: WelcomeModel?

    func show(project: @escaping () -> URL?, chooseProject: @escaping () -> Void, signIn: @escaping () -> Void, changed: @escaping () -> Void) {
        if let window {
            model?.refresh()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let model = WelcomeModel(project: project, chooseProject: chooseProject, signIn: signIn, changed: changed)
        let view = WelcomeView(model: model) { [weak self] in self?.window?.close() }
        let w = NSWindow(contentViewController: NSHostingController(rootView: view))
        w.title = "Darnly"
        w.styleMask = [.titled, .closable]
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
