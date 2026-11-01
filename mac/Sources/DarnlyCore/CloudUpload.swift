import Foundation
import CryptoKit

/// The parts of the cloud inbox that need no UI: sign-in codes and the upload request. Same API as the Chrome extension.
public enum Cloud {
    public static let defaultBase = URL(string: "https://api.darnly.dev")!
    public static let callbackScheme = "darnly"

    /// PKCE: the app keeps `verifier`; the sign-in page only sees `challenge`, so a stolen one-time code is useless.
    public struct Pkce {
        public let verifier: String
        public let challenge: String

        public init(verifier: String) {
            self.verifier = verifier
            self.challenge = Cloud.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        }

        public static func make() -> Pkce {
            var bytes = [UInt8](repeating: 0, count: 32)
            _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            return Pkce(verifier: Cloud.base64url(Data(bytes)))
        }
    }

    public static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public static func signInURL(base: URL = defaultBase, challenge: String) -> URL {
        var c = URLComponents(url: base.appendingPathComponent("app/signin"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "challenge", value: challenge)]
        return c.url!
    }

    public enum CallbackResult: Equatable {
        case code(String)
        case cancelled
        case broken
    }

    /// Reads darnly://signed-in?code=… or ?error=….
    public static func parseCallback(_ url: URL) -> CallbackResult {
        guard url.scheme == callbackScheme, let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return .broken }
        if let code = items.first(where: { $0.name == "code" })?.value, code.range(of: #"^[A-Za-z0-9_-]{20,100}$"#, options: .regularExpression) != nil {
            return .code(code)
        }
        return items.contains(where: { $0.name == "error" }) ? .cancelled : .broken
    }

    /// Where a Mac bug "happened": the server shows it as "<app> (Mac app)".
    public static func pageURL(appName: String) -> String {
        "macos://" + (appName.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "app")
    }

    public struct Part {
        public var name: String
        public var filename: String?
        public var contentType: String
        public var data: Data
        public init(name: String, filename: String? = nil, contentType: String, data: Data) {
            self.name = name
            self.filename = filename
            self.contentType = contentType
            self.data = data
        }
    }

    /// The parts of POST /v1/bugs: meta (title, page, client id for safe retries), the report and the pictures.
    public static func uploadParts(clientId: String = "mac-" + UUID().uuidString, title: String, appName: String, markdown: String, png: Data?, reference: Data?) -> [Part] {
        let meta: [String: String] = ["title": String(title.prefix(300)), "pageUrl": pageURL(appName: appName), "clientId": clientId]
        let metaData = (try? JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys])) ?? Data("{}".utf8)
        var parts = [
            Part(name: "meta", contentType: "application/json", data: metaData),
            Part(name: "report", filename: "report.md", contentType: "text/markdown", data: Data(markdown.utf8)),
        ]
        if let png { parts.append(Part(name: "picture", filename: "picture.png", contentType: "image/png", data: png)) }
        if let reference { parts.append(Part(name: "reference", filename: "reference.png", contentType: "image/png", data: reference)) }
        return parts
    }

    public static func multipart(_ parts: [Part], boundary: String) -> Data {
        var body = Data()
        for p in parts {
            body.append(Data("--\(boundary)\r\n".utf8))
            var disposition = "Content-Disposition: form-data; name=\"\(p.name)\""
            if let f = p.filename { disposition += "; filename=\"\(f)\"" }
            body.append(Data("\(disposition)\r\nContent-Type: \(p.contentType)\r\n\r\n".utf8))
            body.append(p.data)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        return body
    }

    /// Short words for the server's error codes, shown under the menu bar icon.
    public static func explain(_ code: String) -> String {
        switch code {
        case "signed_out": return "You were signed out of the cloud inbox. Sign in again from the Darnly menu."
        case "uploads_paused", "cloud_busy": return "The cloud inbox isn't taking new bugs right now."
        case "daily_limit", "too_many_this_hour", "slow_down": return "You've sent a lot of bugs today; the cloud inbox is taking a break."
        case "storage_full", "inbox_full": return "Your cloud inbox is full. Ask your agent to fix or clear some bugs."
        case "picture_too_large", "reference_too_large", "too_large", "report_too_large": return "This capture is too big for the cloud inbox."
        default: return "Couldn't reach the cloud inbox (\(code))."
        }
    }
}
