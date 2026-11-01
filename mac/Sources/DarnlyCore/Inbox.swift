import Foundation

/// Writes a capture into `<project>/.darnly/inbox/`, the folder the agent reads.
public enum Inbox {
    public static func save(project: URL, id: String, markdown: String, png: Data?, logs: [LogLine]) throws -> URL {
        let fm = FileManager.default
        let root = project.appendingPathComponent(".darnly", isDirectory: true)
        let inbox = root.appendingPathComponent("inbox", isDirectory: true)
        try fm.createDirectory(at: inbox, withIntermediateDirectories: true)
        // Keep captures out of git, like the extension does.
        let ignore = root.appendingPathComponent(".gitignore")
        if !fm.fileExists(atPath: ignore.path) { try "*\n".write(to: ignore, atomically: true, encoding: .utf8) }
        let md = inbox.appendingPathComponent("\(id).md")
        try markdown.write(to: md, atomically: true, encoding: .utf8)
        if let png { try png.write(to: inbox.appendingPathComponent("\(id).png"), options: .atomic) }
        if !logs.isEmpty {
            let enc = JSONEncoder()
            enc.outputFormatting = [.prettyPrinted, .sortedKeys]
            enc.dateEncodingStrategy = .iso8601
            try enc.encode(["entries": logs]).write(to: inbox.appendingPathComponent("\(id).logs.json"), options: .atomic)
        }
        return md
    }
}
