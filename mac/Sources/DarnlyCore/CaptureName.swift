import Foundation

/// A capture file id like `2026-11-05-1402-save-button-cut-off`, the same shape as the extension's.
public func captureId(_ when: Date, _ label: String, calendar: Calendar = .current) -> String {
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: when)
    func p(_ n: Int?) -> String { String(format: "%02d", n ?? 0) }
    let date = "\(c.year ?? 0)-\(p(c.month))-\(p(c.day))"
    let time = "\(p(c.hour))\(p(c.minute))"
    let words = label.lowercased()
        .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        .split(separator: "-")
        .prefix(5)
    let slug = words.isEmpty ? "capture" : words.joined(separator: "-")
    return "\(date)-\(time)-\(slug)"
}
