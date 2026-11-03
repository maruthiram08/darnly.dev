import Foundation

/// Tells the coding agent where the bugs are, exactly as the Chrome extension's setup does (src/lib/agent-setup.ts):
/// a short block in AGENTS.md, the /darnly skill, Cursor's /darnly command and two Claude Code hooks.
/// Every merge keeps the user's own content and returns nil when nothing would change.
public enum AgentSetup {
    public struct Change: Equatable {
        public let path: String
        public let isNew: Bool
        public let content: String
    }

    /// Every file setup reads, relative to the project folder.
    public static var paths: [String] {
        ["AGENTS.md", "CLAUDE.md", ".gitignore", ".claude/settings.json", AgentSetupText.cursorCommandPath] + AgentSetupText.skillPaths
    }

    public static func agentsBlock(project: String?) -> String {
        let name = project.map(ProjectName.clean) ?? ""
        let slot = AgentSetupText.projectSlot
        if name.isEmpty {
            return AgentSetupText.agentsBlock.components(separatedBy: "\n").filter { !$0.contains(slot) }.joined(separator: "\n")
        }
        return AgentSetupText.agentsBlock.replacingOccurrences(of: slot, with: name)
    }

    private static func trimEnd(_ s: String) -> String {
        var s = s
        while let last = s.last, last.isWhitespace { s.removeLast() }
        return s
    }

    public static func mergeAgentsMd(_ existing: String?, project: String?) -> String? {
        let block = agentsBlock(project: project)
        guard let existing, !existing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "# AGENTS.md\n\n\(block)\n" }
        if let start = existing.range(of: AgentSetupText.agentsMarkerStart),
           let end = existing.range(of: AgentSetupText.agentsMarkerEnd, range: start.upperBound..<existing.endIndex) {
            let next = String(existing[..<start.lowerBound]) + block + String(existing[end.upperBound...])
            return next == existing ? nil : next
        }
        return "\(trimEnd(existing))\n\n\(block)\n"
    }

    /// Claude Code reads CLAUDE.md, not AGENTS.md, so an existing CLAUDE.md gets an import line.
    public static func mergeClaudeMd(_ existing: String?) -> String? {
        guard let existing else { return nil }
        if existing.components(separatedBy: .newlines).contains(where: { trimEnd($0) == "@AGENTS.md" }) { return nil }
        return "\(trimEnd(existing))\n\n@AGENTS.md\n"
    }

    /// Only an existing .gitignore: .darnly/.gitignore already keeps captures out of git.
    public static func mergeGitignore(_ existing: String?) -> String? {
        guard let existing else { return nil }
        let lines = existing.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
        if lines.contains(where: { [".darnly", ".darnly/", "/.darnly", "/.darnly/"].contains($0) }) { return nil }
        return "\(trimEnd(existing))\n\n# Darnly bug captures (screenshots can hold private data)\n.darnly/\n"
    }

    /// Adds our two hooks to .claude/settings.json, keeping every other setting and hook. Nil for a file that isn't a JSON object.
    public static func mergeClaudeSettings(_ existing: String?) -> String? {
        var settings: [String: Any] = [:]
        if let existing, !existing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(existing.utf8)) as? [String: Any] else { return nil }
            settings = obj
        }
        var hooks = settings["hooks"] as? [String: Any] ?? [:]
        for (event, command) in [("SessionStart", AgentSetupText.sessionStartHook), ("UserPromptSubmit", AgentSetupText.promptSubmitHook)] {
            let groups = (hooks[event] as? [[String: Any]] ?? []).compactMap { group -> [String: Any]? in
                let kept = (group["hooks"] as? [[String: Any]] ?? []).filter { !(($0["command"] as? String)?.contains(AgentSetupText.hookMark) ?? false) }
                if kept.isEmpty { return nil }
                var g = group
                g["hooks"] = kept
                return g
            }
            hooks[event] = groups + [["hooks": [["type": "command", "command": command]]]]
        }
        var next = settings
        next["hooks"] = hooks
        // Already set up (maybe by the extension, formatted differently): leave the file alone.
        if existing != nil, (next as NSDictionary).isEqual(to: settings) { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: next, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) else { return nil }
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    /// Refreshes our /darnly command, but never overwrites one the user wrote.
    public static func mergeCursorCommand(_ existing: String?) -> String? {
        let next = AgentSetupText.cursorCommand
        if existing == next { return nil }
        let mark = next.components(separatedBy: "\n").first ?? ""
        if let existing, !existing.contains(mark) { return nil }
        return next
    }

    /// Every file setup would write, from the files that exist today (path → contents, missing files left out).
    public static func plan(existing: [String: String], project: String?) -> [Change] {
        var out: [Change] = []
        func add(_ path: String, _ next: String?) {
            if let next { out.append(Change(path: path, isNew: existing[path] == nil, content: next)) }
        }
        add("AGENTS.md", mergeAgentsMd(existing["AGENTS.md"], project: project))
        add("CLAUDE.md", mergeClaudeMd(existing["CLAUDE.md"]))
        add(".gitignore", mergeGitignore(existing[".gitignore"]))
        add(".claude/settings.json", mergeClaudeSettings(existing[".claude/settings.json"]))
        add(AgentSetupText.cursorCommandPath, mergeCursorCommand(existing[AgentSetupText.cursorCommandPath]))
        for p in AgentSetupText.skillPaths where existing[p] != AgentSetupText.skill { add(p, AgentSetupText.skill) }
        return out
    }

    public static func plan(folder: URL, project: String?) -> [Change] {
        var existing: [String: String] = [:]
        for p in paths {
            if let s = try? String(contentsOf: folder.appendingPathComponent(p), encoding: .utf8) { existing[p] = s }
        }
        return plan(existing: existing, project: project)
    }

    public static func apply(_ changes: [Change], in folder: URL) throws {
        for c in changes {
            let url = folder.appendingPathComponent(c.path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try c.content.write(to: url, atomically: true, encoding: .utf8)
        }
    }
}
