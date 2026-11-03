import AppKit
import SwiftUI

/// Darnly's colours, the same as darnly.dev and the Chrome extension's panel.
enum Brand {
    static let sky = NSColor(hex: 0x0593C6)
    static let skyDeep = NSColor(hex: 0x04729A)
    static let pink = NSColor(hex: 0xD83995)
    static let ink = NSColor(hex: 0x0B2230)
    static let inkSoft = NSColor(hex: 0x4A6472)
    static let line = NSColor(hex: 0xD7E9F0)
    static let wash = NSColor(hex: 0xEEF8FB)
    static let page = NSColor(hex: 0xF7FBFC)

    /// Darnly's windows are drawn in the light brand look, like the extension's panel, even in Dark Mode.
    static let appearance = NSAppearance(named: .aqua)
}

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension Color {
    static let sky = Color(nsColor: Brand.sky)
    static let skyDeep = Color(nsColor: Brand.skyDeep)
    static let pink = Color(nsColor: Brand.pink)
    static let ink = Color(nsColor: Brand.ink)
    static let inkSoft = Color(nsColor: Brand.inkSoft)
    static let line = Color(nsColor: Brand.line)
    static let wash = Color(nsColor: Brand.wash)
    static let page = Color(nsColor: Brand.page)
}
