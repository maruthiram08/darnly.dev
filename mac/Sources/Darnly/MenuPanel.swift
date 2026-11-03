import AppKit
import SwiftUI
import DarnlyCore

/// What the menu bar panel shows. The app delegate fills it in and owns the real actions.
final class PanelModel: ObservableObject {
    struct Notice {
        var text: String
        var button: String
        var action: () -> Void
    }

    @Published var destination = Destination.folder
    @Published var folderName: String?
    @Published var cloudEmail: String?
    /// Whether the folder's agent already knows about .darnly/inbox (nil: no folder yet).
    @Published var agentReady: Bool?
    @Published var waiting = 0
    @Published var recent: [(bug: RecentBug, state: RecentBugs.State)] = []
    /// A message above the Capture button, such as a missing permission or a new version.
    @Published var notice: Notice?
    var now: () -> Date = Date.init

    var capture: () -> Void = {}
    var useFolder: () -> Void = {}
    var useCloud: () -> Void = {}
    var chooseFolder: () -> Void = {}
    var setUpAgent: () -> Void = {}
    var openInbox: () -> Void = {}
    var openBug: (RecentBug) -> Void = { _ in }
    var showHelp: () -> Void = {}
    var showMore: () -> Void = {}
    var quit: () -> Void = {}

    /// The panel with a folder (or the cloud) set up and a few bugs, for `--snapshot`.
    static func sample(cloud: Bool) -> PanelModel {
        let m = PanelModel()
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        m.now = { base }
        m.destination = cloud ? .cloud : .folder
        m.folderName = "my-app"
        m.cloudEmail = cloud ? "you@example.com" : nil
        m.agentReady = true
        m.waiting = cloud ? 0 : 2
        let bugs: [(String, String, TimeInterval, RecentBugs.State)] = [
            ("Save plan button does nothing", "Maccy", 120, cloud ? .cloud : .waiting),
            ("Price shows $0 after refresh", "Simulator", 3_000, cloud ? .cloud : .waiting),
            ("Sidebar overlaps the header", "Darnly Notes", 90_000, cloud ? .cloud : .fixed),
        ]
        m.recent = bugs.map { (RecentBug(title: $0.0, app: $0.1, date: base.addingTimeInterval(-$0.2)), $0.3) }
        return m
    }
}

struct PanelView: View {
    @ObservedObject var model: PanelModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(nsImage: Brand.logo(size: 22, template: false))
                Text("Darnly").font(.system(size: 16, weight: .bold)).foregroundStyle(Color.ink)
                Spacer()
                Button(action: model.showMore) {
                    Image(systemName: "ellipsis.circle").font(.system(size: 15)).foregroundStyle(Color.inkSoft)
                }
                .buttonStyle(.plain)
                .help("More")
            }

            if let notice = model.notice {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.pink)
                    Text(notice.text).font(.callout).foregroundStyle(Color.ink).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Button(notice.button, action: notice.action).controlSize(.small)
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.pink.opacity(0.08)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.pink.opacity(0.35)))
            }

            Button(action: model.capture) {
                HStack {
                    Image(systemName: "scope")
                    Text("Capture a bug")
                    Spacer()
                    Text("⌥⇧D").font(.system(size: 12, weight: .medium, design: .rounded)).opacity(0.85)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(CaptureButtonStyle())

            card("Bugs go to") {
                SwiftUI.Picker("", selection: Binding(get: { model.destination }, set: { $0 == .folder ? model.useFolder() : model.useCloud() })) {
                    Text("This Mac").tag(Destination.folder)
                    Text("Cloud inbox").tag(Destination.cloud)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                if model.destination == .folder {
                    HStack(spacing: 6) {
                        Image(systemName: "folder").foregroundStyle(Color.skyDeep)
                        if let name = model.folderName {
                            Text("**\(name)**/\(Report.inboxFolder)").lineLimit(1).truncationMode(.middle).foregroundStyle(Color.ink)
                        } else {
                            Text("No project folder yet").foregroundStyle(Color.inkSoft)
                        }
                        Spacer()
                        Button(model.folderName == nil ? "Choose…" : "Change…", action: model.chooseFolder).controlSize(.small)
                    }
                    .font(.callout)
                    if model.agentReady == false {
                        HStack(spacing: 6) {
                            Image(systemName: "sparkles").foregroundStyle(Color.pink)
                            Text("Your agent doesn't know about Darnly yet").font(.callout).foregroundStyle(Color.inkSoft)
                            Spacer()
                            Button("Set up", action: model.setUpAgent).controlSize(.small)
                        }
                    }
                } else {
                    HStack(spacing: 6) {
                        Image(systemName: "cloud").foregroundStyle(Color.skyDeep)
                        if let email = model.cloudEmail {
                            Text(email).lineLimit(1).truncationMode(.middle).foregroundStyle(Color.ink)
                        } else {
                            Text("Not signed in").foregroundStyle(Color.inkSoft)
                            Spacer()
                            Button("Sign in", action: model.useCloud).controlSize(.small)
                        }
                        Spacer()
                    }
                    .font(.callout)
                }
            }

            card("Recent bugs", trailing: model.destination == .folder && model.waiting > 0 ? "\(model.waiting) waiting" : nil) {
                if model.recent.isEmpty {
                    Text("Nothing captured yet. Press ⌥⇧D over any app window, click what's wrong, and say what you expected.")
                        .font(.callout).foregroundStyle(Color.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(model.recent.prefix(4).enumerated()), id: \.offset) { i, item in
                            if i > 0 { Divider().overlay(Color.line) }
                            bugRow(item.bug, item.state)
                        }
                    }
                }
                if model.destination == .folder && model.folderName != nil {
                    Button(action: model.openInbox) {
                        Label("Open inbox in Finder", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(.plain)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Color.skyDeep)
                }
            }

            HStack(spacing: 14) {
                Button("How to use", action: model.showHelp)
                Spacer()
                Button("Quit", action: model.quit)
            }
            .buttonStyle(.plain)
            .font(.callout)
            .foregroundStyle(Color.inkSoft)
        }
        .padding(14)
        .frame(width: 320)
        .background(Color.page)
        .tint(.sky)
        .environment(\.colorScheme, .light)
    }

    private func bugRow(_ bug: RecentBug, _ state: RecentBugs.State) -> some View {
        Button { model.openBug(bug) } label: {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(bug.title).font(.callout.weight(.medium)).foregroundStyle(Color.ink).lineLimit(1).truncationMode(.tail)
                    Text("\(bug.project ?? bug.app) · \(ago(bug.date))").font(.caption).foregroundStyle(Color.inkSoft).lineLimit(1)
                }
                Spacer(minLength: 6)
                chip(state)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(state == .cloud || state == .missing)
    }

    private func chip(_ state: RecentBugs.State) -> some View {
        let (text, fg, bg): (String, Color, Color) = switch state {
        case .waiting: ("Waiting", Color.skyDeep, Color.wash)
        case .fixed: ("Fixed", Color(nsColor: NSColor(hex: 0x15803D)), Color(nsColor: NSColor(hex: 0xDCFCE7)))
        case .cloud: ("In cloud", Color.skyDeep, Color.wash)
        case .missing: ("Removed", Color.inkSoft, Color(nsColor: NSColor(hex: 0xF1F5F9)))
        }
        return Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(bg))
    }

    private func ago(_ date: Date) -> String {
        let s = max(0, model.now().timeIntervalSince(date))
        switch s {
        case ..<60: return "just now"
        case ..<3_600: return "\(Int(s / 60)) min ago"
        case ..<86_400: return "\(Int(s / 3_600)) h ago"
        default: return "\(Int(s / 86_400)) d ago"
        }
    }

    private func card<Content: View>(_ title: String, trailing: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(0.5).foregroundStyle(Color.inkSoft)
                Spacer()
                if let trailing { Text(trailing).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.pink) }
            }
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.line))
    }
}

/// The big sky-blue Capture button at the top of the panel.
struct CaptureButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 10).fill(configuration.isPressed ? Color.skyDeep : Color.sky))
    }
}
