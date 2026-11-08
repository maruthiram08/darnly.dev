import Foundation

/// Finds a newer Darnly for Mac on GitHub releases (tags `mac-v<version>`). No packages, no auto-install:
/// the app only says an update is out and links the DMG; Homebrew users run `brew upgrade --cask darnly`.
public enum UpdateCheck {
    public static let releasesAPI = URL(string: "https://api.github.com/repos/maruthiram08/darnly.dev/releases?per_page=30")!
    public static let releasesPage = URL(string: "https://github.com/maruthiram08/darnly.dev/releases")!
    public static let brewCommand = "brew upgrade --cask darnly"

    public struct Release: Equatable {
        public let version: String
        public let downloadURL: URL
        public let pageURL: URL
    }

    /// "mac-v0.3.2" -> [0, 3, 2]. Anything else (the extension's or the site's tags) -> nil.
    public static func version(fromTag tag: String) -> [Int]? {
        guard tag.hasPrefix("mac-v") else { return nil }
        return parse(String(tag.dropFirst(5)))
    }

    /// "0.3.1" -> [0, 3, 1]. Nil if it isn't plain numbers and dots.
    public static func parse(_ version: String) -> [Int]? {
        let parts = version.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
        guard !parts.isEmpty, parts.allSatisfy({ $0 != nil && $0! >= 0 }) else { return nil }
        return parts.map { $0! }
    }

    /// True when `a` is a later version than `b` ("0.3.10" > "0.3.9", "0.4" > "0.3.9", "0.3.1" == "0.3.1.0").
    public static func isNewer(_ a: [Int], than b: [Int]) -> Bool {
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// The app opens these links in the browser, so only https addresses on github.com count.
    public static func isGitHubURL(_ url: URL) -> Bool {
        url.scheme == "https" && url.host?.lowercased() == "github.com"
    }

    /// The newest published Mac release in GitHub's releases JSON, if it is newer than `current`.
    /// Drafts and pre-releases are skipped. The download is the release's Darnly.dmg (or its page if there is none).
    public static func newer(than current: String, releasesJSON data: Data) -> Release? {
        guard let mine = parse(current),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return nil }
        var best: (v: [Int], r: Release)?
        for item in list {
            if item["draft"] as? Bool == true || item["prerelease"] as? Bool == true { continue }
            guard let tag = item["tag_name"] as? String, let v = version(fromTag: tag),
                  let page = (item["html_url"] as? String).flatMap(URL.init(string:)), isGitHubURL(page) else { continue }
            let assets = item["assets"] as? [[String: Any]] ?? []
            let dmg = assets.first { ($0["name"] as? String)?.lowercased().hasSuffix(".dmg") == true }
            let download = (dmg?["browser_download_url"] as? String).flatMap(URL.init(string:)).flatMap { isGitHubURL($0) ? $0 : nil } ?? page
            if best == nil || isNewer(v, than: best!.v) {
                best = (v, Release(version: v.map(String.init).joined(separator: "."), downloadURL: download, pageURL: page))
            }
        }
        guard let best, isNewer(best.v, than: mine) else { return nil }
        return best.r
    }

    /// Asks GitHub once. Returns nil on any failure (offline, rate limit): a missed check is harmless.
    public static func fetch(current: String) async -> Release? {
        var req = URLRequest(url: releasesAPI, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Darnly-Mac/\(current)", forHTTPHeaderField: "User-Agent")
        guard let (data, res) = try? await URLSession.shared.data(for: req),
              (res as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return newer(than: current, releasesJSON: data)
    }

    /// Installed with Homebrew? Then `brew upgrade` is the way to update, not the DMG.
    public static var installedWithHomebrew: Bool {
        ["/opt/homebrew/Caskroom/darnly", "/usr/local/Caskroom/darnly"].contains { FileManager.default.fileExists(atPath: $0) }
    }
}
