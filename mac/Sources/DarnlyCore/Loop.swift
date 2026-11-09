import Foundation

/// Closing the loop: noticing when the agent fixed a bug or asked the user something, the same way the Chrome extension's panel does.
public enum Loop {
    /// The agent's open question in a local report: its `**Question:** …` line (the agent removes it once answered).
    public static func question(inMarkdown md: String) -> String? {
        for line in md.split(separator: "\n", omittingEmptySubsequences: false) where line.hasPrefix("**Question:** ") {
            let q = line.dropFirst("**Question:** ".count).trimmingCharacters(in: .whitespaces)
            if !q.isEmpty { return String(q.prefix(200)) }
        }
        return nil
    }

    /// What the cloud inbox says about one bug (GET /v1/bugs).
    public struct CloudStatus: Equatable {
        public var fixed: Bool
        /// What the agent asked through `ask_user` and is waiting on (the server drops stale ones).
        public var question: String?
        public init(fixed: Bool, question: String? = nil) {
            self.fixed = fixed
            self.question = question
        }
    }

    /// GET /v1/bugs's `{ bugs: [...] }`, by bug id. Junk gives an empty answer.
    public static func cloudStatuses(_ data: Data) -> [String: CloudStatus] {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let bugs = root["bugs"] as? [[String: Any]] else { return [:] }
        var out: [String: CloudStatus] = [:]
        for b in bugs {
            guard let id = b["id"] as? String else { continue }
            let fixed = (b["status"] as? String) == "fixed"
            let q = (b["question"] as? String).map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)) }
            out[id] = CloudStatus(fixed: fixed, question: fixed || q?.isEmpty != false ? nil : q)
        }
        return out
    }

    /// The new bug's id in POST /v1/bugs's answer.
    public static func uploadedId(_ data: Data) -> String? {
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["id"] as? String
    }

    /// What the panel saw last time, kept across launches: each bug's state and when it looked.
    public struct Seen: Codable, Equatable {
        public var at: Date
        public var states: [String: String]
        public init(at: Date, states: [String: String]) {
            self.at = at
            self.states = states
        }
    }

    public struct Changes: Equatable {
        /// Bugs the agent fixed since the last look.
        public var fixed: [RecentBug] = []
        /// Bugs the agent has a new question about.
        public var asked: [RecentBug] = []
    }

    /// Bugs fixed or newly asked about since `before`. Bugs it never saw count when they are newer than its last look.
    /// With nothing saved (first run), nothing counts, so old fixes don't pop up all at once.
    public static func changes(before: Seen?, now: [(bug: RecentBug, state: RecentBugs.State)]) -> Changes {
        guard let before else { return Changes() }
        var c = Changes()
        for (bug, state) in now {
            let was = before.states[bug.key].flatMap(RecentBugs.State.init(rawValue:))
            let unseen = was == nil && bug.date > before.at
            switch state {
            case .fixed where was == .waiting || was == .asked || unseen: c.fixed.append(bug)
            case .asked where was != .asked && (was != nil || unseen): c.asked.append(bug)
            default: break
            }
        }
        return c
    }

    /// What to remember now. A cloud bug whose status isn't known this time (offline, not asked yet) keeps the state seen before,
    /// so a fix made while the Mac was offline still counts once the cloud answers again.
    public static func seen(_ now: [(bug: RecentBug, state: RecentBugs.State)], keeping before: Seen? = nil, at: Date = Date()) -> Seen {
        var states: [String: String] = [:]
        for (bug, state) in now where states[bug.key] == nil {
            states[bug.key] = state == .cloud ? before?.states[bug.key] ?? state.rawValue : state.rawValue
        }
        return Seen(at: at, states: states)
    }

    public static func decodeSeen(_ data: Data?) -> Seen? {
        guard let data else { return nil }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try? dec.decode(Seen.self, from: data)
    }

    public static func encodeSeen(_ s: Seen) -> Data {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        return (try? enc.encode(s)) ?? Data()
    }

    /// The number beside the menu bar icon: bugs still waiting (nothing when there are none, "99+" past 99).
    public static func badge(_ n: Int) -> String {
        n <= 0 ? "" : n > 99 ? "99+" : String(n)
    }

    /// "1 bug fixed: Save plan button. Take a look." / "3 bugs fixed. Take a look."
    public static func fixedMessage(_ bugs: [RecentBug]) -> String {
        switch bugs.count {
        case 0: return ""
        case 1: return "Your agent fixed \"\(Report.oneLine(bugs[0].title, max: 60))\". Take a look."
        default: return "Your agent fixed \(bugs.count) bugs. Take a look."
        }
    }
}
