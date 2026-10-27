import Foundation

// Shared by the app and the DelivrScreenReader extension through the App Group.
// Holds ONLY status values (state, heartbeat, counters, an error message). Never frames, images or text.
// This file must be a member of BOTH targets.
enum ScreenReaderStore {
    static let appGroup = "group.app.delivr.mobile"
    static let extensionBundleId = "app.delivr.mobile.DelivrScreenReader"

    enum Key {
        static let state = "sr.state"            // "reading" | "stopped" | "failed"
        static let startedAt = "sr.startedAt"    // epoch ms
        static let lastTickAt = "sr.lastTickAt"  // epoch ms, updated every sample (changed or not)
        static let ticks = "sr.ticks"            // samples taken since start
        static let changedFrames = "sr.changed"  // samples that differed from the previous one
        static let error = "sr.error"            // human-readable reason when state == "failed"
    }

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func set(_ key: String, _ value: Any?) {
        defaults?.set(value, forKey: key)
    }

    static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

    // Snapshot for the JS layer. Nothing here identifies a customer or a screen.
    static func snapshot() -> [String: Any] {
        guard let d = defaults else { return ["state": "unavailable"] }
        return [
            "state": d.string(forKey: Key.state) ?? "idle",
            "startedAt": d.double(forKey: Key.startedAt),
            "lastTickAt": d.double(forKey: Key.lastTickAt),
            "ticks": d.integer(forKey: Key.ticks),
            "changedFrames": d.integer(forKey: Key.changedFrames),
            "error": d.string(forKey: Key.error) ?? "",
        ]
    }
}
