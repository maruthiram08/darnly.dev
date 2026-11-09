import Foundation

/// A bug this Mac captured, shown in the menu bar panel's "Recent bugs" list.
public struct RecentBug: Codable, Equatable {
    public var title: String
    public var app: String
    public var date: Date
    /// The report's .md file, for bugs saved into a project folder.
    public var file: String?
    /// The cloud project name, for bugs sent to the cloud inbox.
    public var project: String?
    /// The cloud inbox's id for the bug, so the panel can ask whether it was fixed (bugs sent before 0.3.3 have none).
    public var cloudId: String?

    public init(title: String, app: String, date: Date, file: String? = nil, project: String? = nil, cloudId: String? = nil) {
        self.title = title
        self.app = app
        self.date = date
        self.file = file
        self.project = project
        self.cloudId = cloudId
    }

    /// One key per bug, to remember what the panel last saw.
    public var key: String { file.map { "file:" + $0 } ?? cloudId.map { "cloud:" + $0 } ?? "old:\(title)@\(date.timeIntervalSince1970)" }
}

public enum RecentBugs {
    /// How many are remembered; the panel shows the newest few.
    public static let limit = 20

    public static func adding(_ bug: RecentBug, to list: [RecentBug]) -> [RecentBug] {
        Array(([bug] + list).prefix(limit))
    }

    public static func decode(_ data: Data?) -> [RecentBug] {
        guard let data else { return [] }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return (try? dec.decode([RecentBug].self, from: data)) ?? []
    }

    public static func encode(_ list: [RecentBug]) -> Data {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        return (try? enc.encode(list)) ?? Data("[]".utf8)
    }

    public enum State: String, Equatable {
        /// Still in .darnly/inbox (or waiting in the cloud): the agent hasn't fixed it yet.
        case waiting
        /// The agent asked the user a question about it and is waiting for the answer.
        case asked
        /// Moved to .darnly/done (or marked fixed in the cloud) by the agent.
        case fixed
        /// Sent to the cloud inbox; its status isn't known (signed out, offline, or sent before 0.3.3).
        case cloud
        /// The file is gone (deleted or the folder moved).
        case missing
    }

    /// The bug's state on disk, or from the cloud inbox's answer when it was sent there.
    public static func state(of bug: RecentBug, cloud: [String: Loop.CloudStatus] = [:], fileManager fm: FileManager = .default) -> State {
        guard let file = bug.file else {
            guard let id = bug.cloudId, let s = cloud[id] else { return .cloud }
            if s.fixed { return .fixed }
            return s.question != nil ? .asked : .waiting
        }
        if fm.fileExists(atPath: file) {
            let md = (try? String(contentsOfFile: file, encoding: .utf8)) ?? ""
            return Loop.question(inMarkdown: md) != nil ? .asked : .waiting
        }
        let url = URL(fileURLWithPath: file)
        let done = url.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("done", isDirectory: true).appendingPathComponent(url.lastPathComponent)
        return fm.fileExists(atPath: done.path) ? .fixed : .missing
    }

    /// The agent's question about a bug, if it asked one.
    public static func question(of bug: RecentBug, cloud: [String: Loop.CloudStatus] = [:]) -> String? {
        if let file = bug.file { return (try? String(contentsOfFile: file, encoding: .utf8)).flatMap(Loop.question(inMarkdown:)) }
        return bug.cloudId.flatMap { cloud[$0]?.question }
    }
}

extension Inbox {
    /// How many bug reports are waiting in `<project>/.darnly/inbox`.
    public static func waiting(project: URL, fileManager fm: FileManager = .default) -> Int {
        let inbox = project.appendingPathComponent(".darnly/inbox", isDirectory: true)
        let names = (try? fm.contentsOfDirectory(atPath: inbox.path)) ?? []
        return names.filter { $0.hasSuffix(".md") }.count
    }
}
