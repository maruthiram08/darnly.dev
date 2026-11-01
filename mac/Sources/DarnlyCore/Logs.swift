import Foundation

/// One error line from the app's log, already redacted.
public struct LogLine: Equatable, Codable {
    public var time: Date
    public var level: String // "error", "fault" or "warning"
    public var process: String
    public var message: String

    public init(time: Date, level: String, process: String, message: String) {
        self.time = time
        self.level = level
        self.process = process
        self.message = message
    }
}

/// Where the bug was seen. Decides which log the app reads.
public enum Platform: String, Codable {
    case iosSimulator = "iOS Simulator"
    case androidEmulator = "Android Emulator"
    case mac = "macOS app"
}

public enum Logs {
    static let maxLines = 40
    static let maxMessage = 300

    private static let compact = try! NSRegularExpression(
        pattern: #"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(E|F|Df|I|Db|W)\s+(\S+?)\[\d+:[0-9a-fx]+\]\s+(.*)$"#
    )
    private static let logcat = try! NSRegularExpression(
        pattern: #"^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+([VDIWEF])/([^(]+?)\s*\(\s*\d+\):\s?(.*)$"#
    )

    /// Lines from `log show --style compact` (macOS apps and the iOS Simulator). Keeps errors and faults.
    public static func parseUnifiedLog(_ output: String, timeZone: TimeZone = .current) -> [LogLine] {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSSSSS"
        var out: [LogLine] = []
        for raw in output.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = String(raw)
            let ns = line as NSString
            guard let m = compact.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { continue }
            let type = ns.substring(with: m.range(at: 2))
            guard type == "E" || type == "F" else { continue }
            let stamp = ns.substring(with: m.range(at: 1))
            let time = f.date(from: stamp) ?? f.date(from: String(stamp.prefix(23)) + "000") ?? Date()
            out.append(LogLine(time: time, level: type == "F" ? "fault" : "error", process: ns.substring(with: m.range(at: 3)), message: clean(ns.substring(with: m.range(at: 4)))))
        }
        return Array(out.suffix(maxLines))
    }

    /// Lines from `adb logcat -d -v time` (Android Emulator). Keeps errors and fatal lines from the last `seconds`.
    public static func parseLogcat(_ output: String, now: Date = Date(), seconds: TimeInterval = 60, calendar: Calendar = .current) -> [LogLine] {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        let year = calendar.component(.year, from: now)
        var out: [LogLine] = []
        for raw in output.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = String(raw)
            let ns = line as NSString
            guard let m = logcat.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { continue }
            let level = ns.substring(with: m.range(at: 2))
            guard level == "E" || level == "F" else { continue }
            guard let time = f.date(from: "\(year)-" + ns.substring(with: m.range(at: 1))) else { continue }
            if now.timeIntervalSince(time) > seconds || time.timeIntervalSince(now) > 5 { continue }
            out.append(LogLine(time: time, level: level == "F" ? "fault" : "error", process: ns.substring(with: m.range(at: 3)), message: clean(ns.substring(with: m.range(at: 4)))))
        }
        return Array(out.suffix(maxLines))
    }

    static func clean(_ message: String) -> String {
        let one = message.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        let cut = one.count > maxMessage ? String(one.prefix(maxMessage)) + "…" : one
        return Redact.text(cut)
    }
}
