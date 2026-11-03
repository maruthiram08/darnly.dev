import AppKit

/// What the user typed, plus an optional picture of what they want.
struct NoteResult {
    var note: String
    /// PNG of a picture the user pasted or dropped: what it should look like.
    var reference: Data?
    /// The cloud project the bug goes under (cloud inbox only).
    var project: String?
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
    private var projectField: NSTextField?
    private var reference: Data?
    private var completion: ((NoteResult?) -> Void)?

    /// Largest side of a saved reference picture, in pixels. Big enough to read, small enough for an agent.
    static let maxReferenceSide: CGFloat = 1600

    func show(image: NSImage?, summary: String, project: String? = nil, completion: @escaping (NoteResult?) -> Void) {
        self.completion = completion
        reference = nil
        let content = makeContent(image: image, summary: summary, project: project)
        let panel = NSPanel(contentRect: CGRect(origin: .zero, size: content.fittingSize), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "Darnly"
        panel.level = .floating
        panel.delegate = self
        panel.appearance = Brand.appearance
        panel.backgroundColor = Brand.page
        panel.contentView = content
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        if let tv = textView { panel.makeFirstResponder(tv) }
        NSApp.activate(ignoringOtherApps: true)
        window = panel
    }

    private func label(_ text: String, size: CGFloat = 11, weight: NSFont.Weight = .regular, color: NSColor = Brand.inkSoft) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.font = .systemFont(ofSize: size, weight: weight)
        l.textColor = color
        return l
    }

    /// The panel's contents: the marked screenshot, what was picked, the note box. Also drawn by `--snapshot`.
    func makeContent(image: NSImage?, summary: String, project: String? = nil) -> NSView {
        let width: CGFloat = 440
        let previewHeight: CGFloat = image.map { min(260, width * $0.size.height / max($0.size.width, 1)) } ?? 0
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 18, left: 18, bottom: 18, right: 18)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.widthAnchor.constraint(equalToConstant: width + 36).isActive = true
        stack.wantsLayer = true
        stack.layer?.backgroundColor = Brand.page.cgColor

        // Header: the ladybug and what was picked.
        let bug = NSImageView(image: NSImage(systemSymbolName: "ladybug.fill", accessibilityDescription: nil) ?? NSImage())
        bug.contentTintColor = Brand.pink
        bug.symbolConfiguration = .init(pointSize: 15, weight: .semibold)
        let title = label("New bug", size: 15, weight: .bold, color: Brand.ink)
        let header = NSStackView(views: [bug, title])
        header.spacing = 6
        stack.addArrangedSubview(header)

        if let image {
            let iv = NSImageView(image: image)
            iv.imageScaling = .scaleProportionallyUpOrDown
            iv.wantsLayer = true
            iv.layer?.cornerRadius = 8
            iv.layer?.masksToBounds = true
            iv.layer?.borderWidth = 1
            iv.layer?.borderColor = Brand.line.cgColor
            iv.layer?.backgroundColor = NSColor.white.cgColor
            iv.translatesAutoresizingMaskIntoConstraints = false
            iv.widthAnchor.constraint(equalToConstant: width).isActive = true
            iv.heightAnchor.constraint(equalToConstant: previewHeight).isActive = true
            stack.addArrangedSubview(iv)
        }
        let info = label(summary)
        info.lineBreakMode = .byTruncatingTail
        info.widthAnchor.constraint(equalToConstant: width).isActive = true
        stack.addArrangedSubview(info)
        stack.setCustomSpacing(14, after: info)

        stack.addArrangedSubview(label("What did you expect?", size: 13, weight: .semibold, color: Brand.ink))
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        // The note box: white, rounded, a sky-blue edge.
        let box = NSBox()
        box.boxType = .custom
        box.titlePosition = .noTitle
        box.borderColor = Brand.sky
        box.borderWidth = 1
        box.cornerRadius = 8
        box.fillColor = .white
        box.contentViewMargins = NSSize(width: 2, height: 2)
        box.contentView = scroll
        box.translatesAutoresizingMaskIntoConstraints = false
        box.widthAnchor.constraint(equalToConstant: width).isActive = true
        box.heightAnchor.constraint(equalToConstant: 76).isActive = true
        let tv = NoteTextView(frame: CGRect(x: 0, y: 0, width: width, height: 72))
        tv.autoresizingMask = [.width]
        tv.isVerticallyResizable = true
        tv.minSize = NSSize(width: 0, height: 72)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.textContainer?.widthTracksTextView = true
        tv.textContainerInset = NSSize(width: 6, height: 8)
        tv.font = .systemFont(ofSize: 13)
        tv.textColor = Brand.ink
        tv.backgroundColor = .white
        tv.insertionPointColor = Brand.sky
        tv.delegate = self
        tv.isRichText = false
        tv.onImage = { [weak self] in self?.setReference($0) }
        scroll.documentView = tv
        stack.addArrangedSubview(box)
        let ref = label("")
        stack.addArrangedSubview(ref)

        if let project {
            // Cloud inbox: the project this bug goes under, guessed once and remembered per app. Editing is optional.
            let field = NSTextField(string: project)
            field.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
            field.textColor = Brand.ink
            field.placeholderString = "project name"
            field.widthAnchor.constraint(equalToConstant: 180).isActive = true
            field.toolTip = "Your agent lists the cloud bugs of its project. Darnly remembers this name for the app."
            let row = NSStackView(views: [label("Project", size: 12, weight: .semibold, color: Brand.ink), field])
            row.spacing = 8
            stack.addArrangedSubview(row)
            projectField = field
        } else {
            projectField = nil
        }

        let hint = label("Enter saves · Shift+Enter new line · Esc cancels", color: Brand.inkSoft.withAlphaComponent(0.75))
        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelClicked))
        cancel.bezelStyle = .rounded
        let save = NSButton.brand("Save bug", target: self, action: #selector(saveClicked))
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let footer = NSStackView(views: [hint, spacer, cancel, save])
        footer.spacing = 8
        footer.widthAnchor.constraint(equalToConstant: width).isActive = true
        stack.setCustomSpacing(14, after: stack.arrangedSubviews.last!)
        stack.addArrangedSubview(footer)

        textView = tv
        referenceLabel = ref
        showReferenceState()
        return stack
    }

    @objc private func saveClicked() { finish(currentResult()) }
    @objc private func cancelClicked() { finish(nil) }

    private func currentResult() -> NoteResult {
        NoteResult(note: textView?.string ?? "", reference: reference, project: projectField?.stringValue)
    }

    private func setReference(_ image: NSImage) {
        reference = Self.png(image)
        showReferenceState()
    }

    private func showReferenceState() {
        referenceLabel?.stringValue = reference != nil
            ? "✓ Picture of what it should look like added. Paste another to replace it."
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
            finish(currentResult())
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
