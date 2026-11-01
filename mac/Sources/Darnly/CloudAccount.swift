import AppKit
import AuthenticationServices
import DarnlyCore
import Security

/// Where captures go: the project folder on this Mac, or the Darnly cloud inbox (for agents that run in the cloud).
enum Destination: String {
    case folder, cloud

    static var current: Destination {
        get { Destination(rawValue: UserDefaults.standard.string(forKey: "destination") ?? "") ?? .folder }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "destination") }
    }
}

struct CloudError: Error {
    let code: String
    var message: String { Cloud.explain(code) }
}

/// The cloud inbox account: sign-in through a darnly.dev page, the session token in the Keychain, uploads.
final class CloudAccount: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = CloudAccount()

    /// DARNLY_API=http://localhost:8787 points the app at a local server (development only).
    let base: URL = ProcessInfo.processInfo.environment["DARNLY_API"].flatMap(URL.init(string:)) ?? Cloud.defaultBase
    private var session: ASWebAuthenticationSession?
    private var anchor: NSWindow?

    var email: String? { UserDefaults.standard.string(forKey: "cloudEmail") }
    var isSignedIn: Bool { email != nil && Keychain.read() != nil }

    // MARK: Sign-in

    /// Opens the sign-in sheet; calls back on the main thread with an error message, or nil when signed in.
    func signIn(_ done: @escaping (String?) -> Void) {
        let pkce = Cloud.Pkce.make()
        let s = ASWebAuthenticationSession(url: Cloud.signInURL(base: base, challenge: pkce.challenge), callbackURLScheme: Cloud.callbackScheme) { [weak self] url, error in
            DispatchQueue.main.async {
                self?.session = nil
                self?.anchor?.close()
                self?.anchor = nil
                guard let self else { return }
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin { return done("Sign-in cancelled.") }
                guard let url else { return done("Sign-in didn't finish. Please try again.") }
                switch Cloud.parseCallback(url) {
                case .cancelled: done("Sign-in cancelled.")
                case .broken: done("Sign-in didn't finish. Please try again.")
                case .code(let code):
                    Task {
                        let message = await self.exchange(code: code, verifier: pkce.verifier)
                        await MainActor.run { done(message) }
                    }
                }
            }
        }
        s.presentationContextProvider = self
        // Share the browser's cookies, so a Google account already signed in is offered.
        s.prefersEphemeralWebBrowserSession = false
        session = s
        NSApp.activate(ignoringOtherApps: true)
        if !s.start() { session = nil; done("Couldn't open the sign-in window.") }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let w = NSApp.keyWindow { return w }
        // A menu bar app may have no window open: give the sheet a small one to attach to.
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1, height: 1), styleMask: [], backing: .buffered, defer: false)
        w.center()
        w.makeKeyAndOrderFront(nil)
        anchor = w
        return w
    }

    private func exchange(code: String, verifier: String) async -> String? {
        var req = URLRequest(url: base.appendingPathComponent("v1/auth/app/exchange"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code, "verifier": verifier])
        do {
            let (data, res) = try await URLSession.shared.data(for: req)
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            guard (res as? HTTPURLResponse)?.statusCode == 200, let token = body["token"] as? String, let email = body["email"] as? String else {
                return "Sign-in failed (\(body["error"] as? String ?? "server error")). Please try again."
            }
            Keychain.save(token)
            UserDefaults.standard.set(email, forKey: "cloudEmail")
            return nil
        } catch {
            return "Couldn't reach Darnly: \(error.localizedDescription)"
        }
    }

    func signOut() {
        if let token = Keychain.read() {
            var req = URLRequest(url: base.appendingPathComponent("v1/auth/logout"))
            req.httpMethod = "POST"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
            URLSession.shared.dataTask(with: req).resume()
        }
        forget()
    }

    private func forget() {
        Keychain.delete()
        UserDefaults.standard.removeObject(forKey: "cloudEmail")
    }

    // MARK: Upload

    /// Sends one bug to the cloud inbox. Throws CloudError with the server's code.
    func upload(_ parts: [Cloud.Part]) async throws {
        guard let token = Keychain.read() else { throw CloudError(code: "signed_out") }
        let boundary = "darnly-" + UUID().uuidString
        var req = URLRequest(url: base.appendingPathComponent("v1/bugs"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")
        req.timeoutInterval = 30
        let body = Cloud.multipart(parts, boundary: boundary)
        let (data, res) = try await URLSession.shared.upload(for: req, from: body)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        if (200..<300).contains(status) { return }
        let code = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String ?? "http_\(status)"
        if status == 401 { forget() }
        throw CloudError(code: code)
    }
}

/// The session token, kept in the login Keychain (never in a settings file).
enum Keychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "dev.darnly.mac.cloud",
        kSecAttrAccount as String: "session",
    ]

    static func save(_ token: String) {
        delete()
        var add = query
        add[kSecValueData as String] = Data(token.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func read() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
