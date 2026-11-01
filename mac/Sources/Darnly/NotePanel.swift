import AppKit

/// "What did you expect?" with the marked screenshot. Enter saves, Shift+Enter is a new line, Esc cancels.
final class NotePanel: NSObject, NSTextViewDelegate, NSWindowDelegate {
    private var window: NSPanel?
    private var textView: NSTextView?
    private var completion: ((String?) -> Void)?

    func show(image: NSImage?, summary: String, completion: @escaping (String?) -> Void) {
        self.completion = completion
        let width: CGFloat = 420
        let previewHeight: CGFloat = image.map { min(260, width * $0.size.height / max($0.size.width, 1)) } ?? 0
        let height = previewHeight + 210
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
        let scroll = NSTextView.scrollableTextView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.widthAnchor.constraint(equalToConstant: width).isActive = true
        scroll.heightAnchor.constraint(equalToConstant: 64).isActive = true
        scroll.borderType = .bezelBorder
        let tv = scroll.documentView as! NSTextView
        tv.font = .systemFont(ofSize: 13)
        tv.delegate = self
        tv.isRichText = false
        stack.addArrangedSubview(scroll)
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
    }

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.insertNewline(_:)) {
            if NSApp.currentEvent?.modifierFlags.contains(.shift) == true { return false }
            finish(textView.string)
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

    private func finish(_ note: String?, closeWindow: Bool = true) {
        let done = completion
        completion = nil
        if closeWindow { window?.close() }
        window = nil
        done?(note)
    }
}
