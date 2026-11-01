import AppKit
import DarnlyCore

/// Reads the last minute of errors for the app the bug was seen in.
enum LogCollector {
    struct Result {
        var platform: Platform
        var device: String?
        var bundleId: String?
        var logs: [LogLine]
        var read: Bool
    }

    static func platform(for window: TargetWindow) -> Platform {
        let app = NSRunningApplication(processIdentifier: window.pid)
        let bundle = app?.bundleIdentifier ?? ""
        if bundle == "com.apple.iphonesimulator" { return .iosSimulator }
        let name = window.ownerName.lowercased()
        if name.contains("qemu") || name.contains("emulator") || bundle.contains("android") { return .androidEmulator }
        return .mac
    }

    static func collect(for window: TargetWindow) async -> Result {
        let p = platform(for: window)
        switch p {
        case .iosSimulator:
            // Only apps installed in the simulator (not iOS itself), errors and faults.
            let predicate = #"processImagePath CONTAINS "/Containers/Bundle/Application/" AND (messageType == error OR messageType == fault)"#
            let out = await run("/usr/bin/xcrun", ["simctl", "spawn", "booted", "log", "show", "--last", "60s", "--style", "compact", "--predicate", predicate])
            let device = await simulatorName()
            return Result(platform: p, device: device, bundleId: nil, logs: out.map { Logs.parseUnifiedLog($0) } ?? [], read: out != nil)
        case .androidEmulator:
            guard let adb = adbPath() else { return Result(platform: p, device: nil, bundleId: nil, logs: [], read: false) }
            let out = await run(adb, ["logcat", "-d", "-v", "time", "-t", "2000"])
            let model = await run(adb, ["shell", "getprop", "ro.product.model"])?.trimmingCharacters(in: .whitespacesAndNewlines)
            return Result(platform: p, device: model.map { "\($0) (Android Emulator)" }, bundleId: nil, logs: out.map { Logs.parseLogcat($0) } ?? [], read: out != nil)
        case .mac:
            let predicate = "processID == \(window.pid) AND (messageType == error OR messageType == fault)"
            let out = await run("/usr/bin/log", ["show", "--last", "60s", "--style", "compact", "--predicate", predicate])
            let bundle = NSRunningApplication(processIdentifier: window.pid)?.bundleIdentifier
            return Result(platform: p, device: nil, bundleId: bundle, logs: out.map { Logs.parseUnifiedLog($0) } ?? [], read: out != nil)
        }
    }

    static func simulatorName() async -> String? {
        guard let json = await run("/usr/bin/xcrun", ["simctl", "list", "devices", "booted", "-j"]),
              let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let devices = obj["devices"] as? [String: [[String: Any]]] else { return nil }
        for (runtime, list) in devices {
            if let d = list.first(where: { ($0["state"] as? String) == "Booted" }), let name = d["name"] as? String {
                // "com.apple.CoreSimulator.SimRuntime.iOS-18-2" -> "iOS 18.2"
                let parts = (runtime.split(separator: ".").last ?? "").split(separator: "-").map(String.init)
                guard let os = parts.first else { return name }
                return parts.count > 1 ? "\(name) (\(os) \(parts.dropFirst().joined(separator: ".")))" : name
            }
        }
        return nil
    }

    static func adbPath() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = ["\(home)/Library/Android/sdk/platform-tools/adb", "/opt/homebrew/bin/adb", "/usr/local/bin/adb"]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// Runs a tool and returns its output, or nil if it failed or took longer than `timeout` seconds.
    static func run(_ path: String, _ args: [String], timeout: TimeInterval = 8) async -> String? {
        await withCheckedContinuation { cont in
            DispatchQueue.global().async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: path)
                p.arguments = args
                let pipe = Pipe()
                p.standardOutput = pipe
                p.standardError = FileHandle.nullDevice
                do { try p.run() } catch { return cont.resume(returning: nil) }
                let timer = DispatchWorkItem { if p.isRunning { p.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                timer.cancel()
                cont.resume(returning: p.terminationStatus == 0 ? String(data: data, encoding: .utf8) : nil)
            }
        }
    }
}
