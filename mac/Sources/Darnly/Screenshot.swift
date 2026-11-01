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
