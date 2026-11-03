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
        let note = NotePanel()
        save(note.makeContent(image: sampleScreenshot(), summary: "button \"Save plan\" in Maccy"), to: folder.appendingPathComponent("note-box.png"))
        let cloudNote = NotePanel()
        save(cloudNote.makeContent(image: sampleScreenshot(), summary: "button \"Save plan\" in Maccy", project: "maccy"), to: folder.appendingPathComponent("note-box-cloud.png"))
        print("Saved UI pictures to \(folder.path)")
    }

    /// Lays the view out in an off-screen window and draws it at 2x.
    @MainActor
    private static func save(_ view: NSView, to url: URL) {
        let size = view.fittingSize
        let window = NSWindow(contentRect: CGRect(x: -10_000, y: -10_000, width: size.width, height: size.height), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = Brand.appearance
        window.contentView = view
        view.frame = CGRect(origin: .zero, size: size)
        view.layoutSubtreeIfNeeded()
        view.display()
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2), bitsPerSample: 8, samplesPerPixel: 4,
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
