import AppKit
import SwiftUI

/// `Darnly --snapshot <folder>` draws the welcome screen and the note box into PNGs, then quits.
/// CI runs it so UI changes can be reviewed as pictures without a Mac at hand. It needs no permissions.
enum UISnapshot {
    @MainActor
    static func run(to folder: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for (name, cloud) in [("welcome-this-mac", false), ("welcome-cloud", true)] {
            let view = NSHostingView(rootView: WelcomeView(model: WelcomeModel.sample(cloud: cloud)) {})
            save(view, to: folder.appendingPathComponent("\(name).png"))
        }
        // The menu bar panel: a project folder with bugs waiting and one fixed, the cloud inbox, and a first run.
        for (name, cloud) in [("panel-this-mac", false), ("panel-cloud", true)] {
            save(NSHostingView(rootView: PanelView(model: PanelModel.sample(cloud: cloud))), to: folder.appendingPathComponent("\(name).png"))
        }
        let first = PanelModel()
        first.notice = .init(text: "Allow Accessibility so Darnly knows what you clicked.", button: "Allow") {}
        save(NSHostingView(rootView: PanelView(model: first)), to: folder.appendingPathComponent("panel-first-run.png"))
        let newer = PanelModel.sample(cloud: false)
        newer.notice = .init(text: "Darnly 0.3.3 is available.", button: "Update") {}
        save(NSHostingView(rootView: PanelView(model: newer)), to: folder.appendingPathComponent("panel-update.png"))
        let note = NotePanel()
        save(note.makeContent(image: sampleScreenshot(), summary: "button \"Save plan\" in Maccy"), to: folder.appendingPathComponent("note-box.png"))
        let cloudNote = NotePanel()
        save(cloudNote.makeContent(image: sampleScreenshot(), summary: "button \"Save plan\" in Maccy", project: "maccy"), to: folder.appendingPathComponent("note-box-cloud.png"))
        // The menu bar icon on a light and a dark menu bar, at 4x so it can be checked closely.
        for (name, dark) in [("menu-bar-light", false), ("menu-bar-dark", true)] {
            let bar = NSView(frame: CGRect(x: 0, y: 0, width: 120, height: 24))
            bar.wantsLayer = true
            bar.layer?.backgroundColor = (dark ? NSColor(white: 0.16, alpha: 1) : NSColor(white: 0.93, alpha: 1)).cgColor
            let tinted = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { r in
                Brand.logo().draw(in: r)
                (dark ? NSColor.white : NSColor.black).set()
                r.fill(using: .sourceAtop)
                return true
            }
            for (i, img) in [tinted, NSImage(systemSymbolName: "wifi", accessibilityDescription: nil)].enumerated() {
                guard let img else { continue }
                let iv = NSImageView(frame: CGRect(x: 20 + i * 40, y: 3, width: 18, height: 18))
                iv.image = img
                iv.contentTintColor = dark ? .white : .black
                bar.addSubview(iv)
            }
            save(bar, to: folder.appendingPathComponent("\(name).png"), scale: 4)
        }
        save(NSImageView(image: Brand.logo(size: 64, template: false)), to: folder.appendingPathComponent("logo-colour.png"))
        print("Saved UI pictures to \(folder.path)")
    }

    /// Lays the view out in an off-screen window and draws it at 2x.
    @MainActor
    private static func save(_ view: NSView, to url: URL, scale: CGFloat = 2) {
        let size = view.fittingSize == .zero ? view.frame.size : view.fittingSize
        let window = NSWindow(contentRect: CGRect(x: -10_000, y: -10_000, width: size.width, height: size.height), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = Brand.appearance
        window.contentView = view
        view.frame = CGRect(origin: .zero, size: size)
        view.layoutSubtreeIfNeeded()
        view.display()
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale), bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
        rep.size = size
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
        window.contentView = nil
    }

    /// A stand-in for a marked screenshot: a plain app window with a red box around a button.
    private static func sampleScreenshot() -> NSImage {
        NSImage(size: NSSize(width: 800, height: 480), flipped: true) { r in
            NSColor(white: 0.97, alpha: 1).setFill(); r.fill()
            NSColor(white: 0.9, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: r.width, height: 44).fill()
            for (i, c) in [NSColor.systemRed, .systemYellow, .systemGreen].enumerated() {
                c.setFill(); NSBezierPath(ovalIn: NSRect(x: 16 + i * 22, y: 15, width: 14, height: 14)).fill()
            }
            NSColor(white: 0.85, alpha: 1).setFill()
            for i in 0..<5 { NSBezierPath(roundedRect: NSRect(x: 40, y: 80 + i * 56, width: 720, height: 40), xRadius: 6, yRadius: 6).fill() }
            NSColor.systemBlue.setFill()
            NSBezierPath(roundedRect: NSRect(x: 600, y: 400, width: 160, height: 44), xRadius: 8, yRadius: 8).fill()
            NSColor.red.setStroke()
            let box = NSBezierPath(rect: NSRect(x: 594, y: 394, width: 172, height: 56)); box.lineWidth = 4; box.stroke()
            return true
        }
    }
}
