import Carbon.HIToolbox

/// A system-wide keyboard shortcut (works whichever app is in front).
final class Hotkey {
    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let action: () -> Void
    private static var actions: [UInt32: () -> Void] = [:]

    /// Default: Option+Shift+D ("D" for Darnly; the browser extension uses Option+Shift+B).
    init(keyCode: UInt32 = UInt32(kVK_ANSI_D), modifiers: UInt32 = UInt32(optionKey | shiftKey), action: @escaping () -> Void) {
        self.action = action
        let id: UInt32 = 1
        Hotkey.actions[id] = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ -> OSStatus in
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            DispatchQueue.main.async { Hotkey.actions[hk.id]?() }
            return noErr
        }, 1, &spec, nil, &handler)
        let hotKeyID = EventHotKeyID(signature: OSType(0x44524E4C), id: id) // 'DRNL'
        RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &ref)
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        if let handler { RemoveEventHandler(handler) }
    }
}
