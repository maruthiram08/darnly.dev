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

    public init(title: String, app: String, date: Date, file: String? = nil, project: String? = nil) {
        self.title = title
        self.app = app
        self.date = date
        self.file = file
        self.project = project
    }
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

    public enum State: Equatable {
        /// Still in .darnly/inbox: the agent hasn't fixed it yet.
        case waiting
        /// Moved to .darnly/done by the agent.
        case fixed
        /// Sent to the cloud inbox.
        case cloud
        /// The file is gone (deleted or the folder moved).
        case missing
    }

    public static func state(of bug: RecentBug, fileManager fm: FileManager = .default) -> State {
        guard let file = bug.file else { return .cloud }
        if fm.fileExists(atPath: file) { return .waiting }
        let url = URL(fileURLWithPath: file)
        let done = url.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("done", isDirectory: true).appendingPathComponent(url.lastPathComponent)
        return fm.fileExists(atPath: done.path) ? .fixed : .missing
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
