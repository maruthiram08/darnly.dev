import Foundation

/// The project a cloud bug belongs to, the same names the Chrome extension uses, so an agent asking the cloud for
/// "this project's bugs" gets the Mac ones too.
public enum ProjectName {
    /// As the cloud stores it: lowercase letters, digits, dots, dashes and underscores, at most 60 characters.
    public static func clean(_ v: String) -> String {
        var out = ""
        var dash = false
        for ch in v.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            if ch.isASCII && (ch.isLetter || ch.isNumber || ch == "." || ch == "_" || ch == "-") {
                out.append(ch)
                dash = ch == "-"
            } else if !dash {
                out.append("-")
                dash = true
            }
        }
        while out.hasPrefix("-") { out.removeFirst() }
        while out.hasSuffix("-") { out.removeLast() }
        return String(out.prefix(60))
    }

    /// A first guess the user never has to type: the name they saved for this app, else the project folder's name
    /// (what setup writes into AGENTS.md), else the app's own name.
    public static func suggest(saved: String?, folder: URL?, appName: String) -> String {
        for s in [saved, folder?.lastPathComponent, appName] {
            if let s { let c = clean(s); if !c.isEmpty { return c } }
        }
        return "my-app"
    }
}
