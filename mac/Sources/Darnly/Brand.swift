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

/// The filled sky-blue button, like the extension's primary buttons.
struct BrandButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 8).fill(configuration.isPressed ? Color.skyDeep : Color.sky))
    }
}

extension NSButton {
    /// A filled sky-blue AppKit button with white text.
    static func brand(_ title: String, target: AnyObject?, action: Selector) -> NSButton {
        let b = NSButton(title: title, target: target, action: action)
        b.isBordered = false
        b.wantsLayer = true
        b.layer?.backgroundColor = Brand.sky.cgColor
        b.layer?.cornerRadius = 7
        b.attributedTitle = NSAttributedString(string: title, attributes: [.foregroundColor: NSColor.white, .font: NSFont.systemFont(ofSize: 13, weight: .semibold)])
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 28).isActive = true
        b.widthAnchor.constraint(equalToConstant: b.intrinsicContentSize.width + 28).isActive = true
        return b
    }
}

extension Brand {
    /// The red of the box in Darnly's app icon.
    static let mark = NSColor(hex: 0xE11D48)

    /// Darnly's logo: a rounded box with a dot on its lower right corner, the way a capture marks a bug.
    /// `template: true` draws it in black for the menu bar, where macOS tints it to match light or dark menu bars.
    static func logo(size: CGFloat = 18, template: Bool = true) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { r in
            let s = r.width / 18                          // drawn on an 18-point grid
            let color = template ? NSColor.black : Brand.mark
            let box = NSBezierPath(roundedRect: NSRect(x: 2.5 * s, y: 2.5 * s, width: 11.5 * s, height: 11.5 * s), xRadius: 2.2 * s, yRadius: 2.2 * s)
            box.lineWidth = 2 * s
            color.setStroke()
            box.stroke()
            // Clear a ring around the dot, then draw the dot, like the white ring on the app icon.
            let centre = NSPoint(x: 13.6 * s, y: 13.6 * s)
            NSGraphicsContext.current?.compositingOperation = .clear
            NSBezierPath(ovalIn: NSRect(x: centre.x - 4.2 * s, y: centre.y - 4.2 * s, width: 8.4 * s, height: 8.4 * s)).fill()
            NSGraphicsContext.current?.compositingOperation = .sourceOver
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: centre.x - 2.7 * s, y: centre.y - 2.7 * s, width: 5.4 * s, height: 5.4 * s)).fill()
            return true
        }
        image.isTemplate = template
        image.accessibilityDescription = "Darnly"
        return image
    }
}
