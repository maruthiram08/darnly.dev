import AppKit
import ScreenCaptureKit

enum Screenshot {
    /// Captures one window (not what's on top of it), at full resolution.
    static func capture(_ window: TargetWindow) async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let w = content.windows.first(where: { $0.windowID == window.id }) else { throw CaptureError.windowGone }
        let filter = SCContentFilter(desktopIndependentWindow: w)
        let config = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        config.width = Int(window.frame.width * scale)
        config.height = Int(window.frame.height * scale)
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    /// The whole screen under the mouse, as it looked when the hotkey was pressed. Taken before the picker
    /// appears, because menus, pop-overs and notch panels often hide the moment something covers them.
    struct Frozen {
        let image: CGImage
        /// The display's frame in global points, top-left origin.
        let frame: CGRect
    }

    static func freezeScreen(at mouse: NSPoint) async -> Frozen? {
        guard let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main,
              let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true),
              let display = content.displays.first(where: { $0.displayID == number.uint32Value }) else { return nil }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        let scale = screen.backingScaleFactor
        config.width = Int(screen.frame.width * scale)
        config.height = Int(screen.frame.height * scale)
        config.showsCursor = false
        guard let image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) else { return nil }
        let frame = CGRect(x: screen.frame.minX, y: Probe.primaryHeight - screen.frame.maxY, width: screen.frame.width, height: screen.frame.height)
        return Frozen(image: image, frame: frame)
    }

    /// The part of the frozen screen covered by a window (global top-left points), or nil if it isn't on that screen.
    static func crop(_ frozen: Frozen, to rect: CGRect) -> CGImage? {
        // Only when the whole window is on that screen, so the box and ring still line up.
        guard frozen.frame.contains(rect), rect.width > 1, rect.height > 1 else { return nil }
        let r = rect
        let sx = CGFloat(frozen.image.width) / frozen.frame.width
        let sy = CGFloat(frozen.image.height) / frozen.frame.height
        let px = CGRect(x: (r.minX - frozen.frame.minX) * sx, y: (r.minY - frozen.frame.minY) * sy, width: r.width * sx, height: r.height * sy).integral
        return frozen.image.cropping(to: px)
    }

    /// Draws the red box (element) and a ring (where the user clicked). Rects and points are in window points, top-left origin.
    static func mark(_ image: CGImage, windowSize: CGSize, box: CGRect?, click: CGPoint?) -> Data? {
        let w = image.width, h = image.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        let sx = CGFloat(w) / max(windowSize.width, 1), sy = CGFloat(h) / max(windowSize.height, 1)
        // CGContext has a bottom-left origin.
        func flip(_ r: CGRect) -> CGRect { CGRect(x: r.minX * sx, y: CGFloat(h) - r.maxY * sy, width: r.width * sx, height: r.height * sy) }
        let red = CGColor(red: 0.88, green: 0.11, blue: 0.28, alpha: 1)
        if let box {
            ctx.setStrokeColor(red)
            ctx.setLineWidth(max(3, 3 * sx))
            ctx.stroke(flip(box).insetBy(dx: -2 * sx, dy: -2 * sy))
        }
        if let click {
            let r = 9 * sx
            let c = CGPoint(x: click.x * sx, y: CGFloat(h) - click.y * sy)
            ctx.setStrokeColor(red)
            ctx.setLineWidth(max(2, 2 * sx))
            ctx.strokeEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
        }
        guard let out = ctx.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: out).representation(using: .png, properties: [:])
    }
}

enum CaptureError: LocalizedError {
    case windowGone
    var errorDescription: String? { "The window closed before it could be captured." }
}
