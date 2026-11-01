import AppKit

/// What the user typed, plus an optional picture of what they want.
struct NoteResult {
    var note: String
    /// PNG of a picture the user pasted or dropped: what it should look like.
    var reference: Data?
}

/// The note box. Pasting or dropping a picture adds it as "what it should look like"; text pastes as text.
final class NoteTextView: NSTextView {
    var onImage: ((NSImage) -> Void)?

    /// A picture on the pasteboard that the user means as a reference: an image file, or image data with no text
    /// (text copied from a web page can carry an image too, and then the text is what they meant).
    static func image(from pb: NSPasteboard) -> NSImage? {
        let imageTypes = NSImage.imageTypes
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true, .urlReadingContentsConformToTypes: imageTypes]) as? [URL],
           let url = urls.first, let img = NSImage(contentsOf: url) { return img }
        if pb.string(forType: .string) != nil { return nil }
        return NSImage(pasteboard: pb)
    }

    override func paste(_ sender: Any?) {
        if let img = Self.image(from: .general) { onImage?(img) } else { super.paste(sender) }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        Self.image(from: sender.draggingPasteboard) != nil ? .copy : super.draggingEntered(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        Self.image(from: sender.draggingPasteboard) != nil ? .copy : super.draggingUpdated(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if let img = Self.image(from: sender.draggingPasteboard) { onImage?(img); return true }
        return super.performDragOperation(sender)
    }
}

/// "What did you expect?" with the marked screenshot. Enter saves, Shift+Enter is a new line, Esc cancels.
final class NotePanel: NSObject, NSTextViewDelegate, NSWindowDelegate {
    private var window: NSPanel?
    private var textView: NoteTextView?
    private var referenceLabel: NSTextField?
    private var reference: Data?
    private var completion: ((NoteResult?) -> Void)?

    /// Largest side of a saved reference picture, in pixels. Big enough to read, small enough for an agent.
    static let maxReferenceSide: CGFloat = 1600

    func show(image: NSImage?, summary: String, completion: @escaping (NoteResult?) -> Void) {
        self.completion = completion
        reference = nil
        let width: CGFloat = 420
        let previewHeight: CGFloat = image.map { min(260, width * $0.size.height / max($0.size.width, 1)) } ?? 0
        let height = previewHeight + 230
        let panel = NSPanel(contentRect: CGRect(x: 0, y: 0, width: width + 32, height: height), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "Darnly"
        panel.level = .floating
        panel.delegate = self
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        if let image {
            let iv = NSImageView(image: image)
            iv.imageScaling = .scaleProportionallyUpOrDown
            iv.translatesAutoresizingMaskIntoConstraints = false
            iv.widthAnchor.constraint(equalToConstant: width).isActive = true
            iv.heightAnchor.constraint(equalToConstant: previewHeight).isActive = true
            stack.addArrangedSubview(iv)
        }
        let info = NSTextField(labelWithString: summary)
        info.textColor = .secondaryLabelColor
        info.font = .systemFont(ofSize: 11)
        info.lineBreakMode = .byTruncatingTail
        info.widthAnchor.constraint(equalToConstant: width).isActive = true
        stack.addArrangedSubview(info)
        stack.addArrangedSubview(NSTextField(labelWithString: "What did you expect?"))
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.widthAnchor.constraint(equalToConstant: width).isActive = true
        scroll.heightAnchor.constraint(equalToConstant: 64).isActive = true
        let tv = NoteTextView(frame: CGRect(x: 0, y: 0, width: width, height: 64))
        tv.autoresizingMask = [.width]
        tv.isVerticallyResizable = true
        tv.minSize = NSSize(width: 0, height: 64)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.textContainer?.widthTracksTextView = true
        tv.font = .systemFont(ofSize: 13)
        tv.delegate = self
        tv.isRichText = false
        tv.onImage = { [weak self] in self?.setReference($0) }
        scroll.documentView = tv
        stack.addArrangedSubview(scroll)
        let ref = NSTextField(labelWithString: "")
        ref.font = .systemFont(ofSize: 11)
        ref.textColor = .secondaryLabelColor
        stack.addArrangedSubview(ref)
        let hint = NSTextField(labelWithString: "Enter to save · Shift+Enter for a new line · Esc to cancel")
        hint.textColor = .tertiaryLabelColor
        hint.font = .systemFont(ofSize: 11)
        stack.addArrangedSubview(hint)
        panel.contentView = stack
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(tv)
        NSApp.activate(ignoringOtherApps: true)
        window = panel
        textView = tv
        referenceLabel = ref
        showReferenceState()
    }

    private func setReference(_ image: NSImage) {
        reference = Self.png(image)
        showReferenceState()
    }

    private func showReferenceState() {
        referenceLabel?.stringValue = reference != nil
            ? "✓ Picture of what you want added. Paste another to replace it."
            : "Optional: paste or drop a picture of what it should look like."
    }

    /// PNG of the picture, shrunk so its longest side is at most maxReferenceSide pixels.
    static func png(_ image: NSImage) -> Data? {
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        let scale = min(1, maxReferenceSide / max(w, h, 1))
        let size = CGSize(width: max(1, (w * scale).rounded()), height: max(1, (h * scale).rounded()))
        guard let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(origin: .zero, size: size))
        guard let out = ctx.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: out).representation(using: .png, properties: [:])
    }

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.insertNewline(_:)) {
            if NSApp.currentEvent?.modifierFlags.contains(.shift) == true { return false }
            finish(NoteResult(note: textView.string, reference: reference))
            return true
        }
        if selector == #selector(NSResponder.cancelOperation(_:)) {
            finish(nil)
            return true
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        if completion != nil { finish(nil, closeWindow: false) }
    }

    private func finish(_ result: NoteResult?, closeWindow: Bool = true) {
        let done = completion
        completion = nil
        if closeWindow { window?.close() }
        window = nil
        reference = nil
        done?(result)
    }
}
