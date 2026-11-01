import Foundation

/// Hides secrets before anything is written. Same rules as the Chrome extension (src/lib/redact.ts).
public enum Redact {
    public static let hidden = "[hidden]"

    private static let patterns: [NSRegularExpression] = [
        #"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"#, // JWT
        #"\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}"#, // Stripe, OpenAI, Anthropic style keys
        #"\bgh[pousr]_[A-Za-z0-9]{20,}"#, // GitHub tokens
        #"\bgithub_pat_[A-Za-z0-9_]{20,}"#,
        #"\bAKIA[0-9A-Z]{16}\b"#, // AWS access key id
        #"\bAIza[0-9A-Za-z_-]{30,}"#, // Google API key
        #"\bxox[abprs]-[A-Za-z0-9-]{10,}"#, // Slack
        #"(?i)\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}"#,
        #"\b[A-Fa-f0-9]{40,}\b"#, // long hex
        #"\b(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{40,}={0,2}"#, // long random token (no "/", so URL paths survive)
    ].map { try! NSRegularExpression(pattern: $0) }

    private static let secretName = try! NSRegularExpression(
        pattern: #"token|key|secret|session|^code$|password|passwd|pwd|auth|sig(nature)?|credential|otp|jwt|apikey"#,
        options: [.caseInsensitive]
    )
    private static let pair = try! NSRegularExpression(pattern: #"(["']?)([A-Za-z_][\w-]*)\1(\s*[:=]\s*)(["']?)([^"'\s&,;}]{4,})\4"#)

    public static func isSecretName(_ name: String) -> Bool {
        secretName.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
    }

    public static func text(_ input: String) -> String {
        var out = input
        for p in patterns {
            out = p.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: hidden)
        }
        // name=value or "name": "value" pairs with secret-looking names.
        // When the name isn't secret, look again right after it, so "plan: token=abc" still hides the token.
        let ns = out as NSString
        var result = ""
        var last = 0
        var from = 0
        while from < ns.length, let m = pair.firstMatch(in: out, range: NSRange(location: from, length: ns.length - from)) {
            let name = ns.substring(with: m.range(at: 2))
            let q = ns.substring(with: m.range(at: 1))
            guard isSecretName(name) else {
                from = m.range.location + (q as NSString).length + (name as NSString).length
                continue
            }
            result += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let sep = ns.substring(with: m.range(at: 3))
            let vq = ns.substring(with: m.range(at: 4))
            result += "\(q)\(name)\(q)\(sep)\(vq)\(hidden)\(vq)"
            last = m.range.location + m.range.length
            from = last
        }
        result += ns.substring(from: last)
        return result
    }
}
