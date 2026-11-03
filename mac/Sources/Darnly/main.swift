import AppKit

// A menu bar app: no Dock icon, no main window.
let app = NSApplication.shared
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--snapshot") {
    // Pictures of the UI for review (CI), then quit.
    let folder = URL(fileURLWithPath: i + 1 < args.count ? args[i + 1] : "snapshots", isDirectory: true)
    MainActor.assumeIsolated { UISnapshot.run(to: folder) }
    exit(0)
}
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
