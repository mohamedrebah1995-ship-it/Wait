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
        static let ocrPasses = "sr.ocrPasses"    // frames sent to OCR since start
        static let events = "sr.events"          // events written to the log since start
        static let peakMB = "sr.peakMB"          // extension memory peak (phys_footprint) since start
        static let lastMB = "sr.lastMB"          // memory after the latest OCR pass
        static let logVersion = "sr.logVersion"  // event-log format the stored log was written in
        static let passedGate = "sr.passedGate"  // changed frames that showed a delivery-app button
        static let seq = "sr.seq"                // last event sequence number (never reset)
        static let runOrders = "sr.runOrders"    // orders in the current run (0 = IDLE)
        static let runEndedAt = "sr.runEndedAt"  // epoch ms the driver tapped End run
        static let lastVerdict = "sr.lastVerdict" // text of the last offer notification
        static let evalURL = "sr.evalURL"        // server base URL for /evaluate (from the app)
        static let authState = "sr.authState"    // "ok" | "offline" | "reconnect" — server sign-in (tokens live in the keychain)
        static let fix = "sr.fix"                // [lat, lng, epoch ms]: driver's position, rounded ~100 m
        static let avgRate = "sr.avgRate"        // driver's all-time £/hour from My Stats
    }

    static let defaultMinRate = 15.0             // £/hr threshold until the driver has stats

    static func minRate() -> Double {
        let r = defaults?.double(forKey: Key.avgRate) ?? 0
        return r > 0 ? r : defaultMinRate
    }

    // The driver's position if the app recorded one in the last `maxAge` seconds.
    static func freshFix(maxAge: TimeInterval = 120) -> (lat: Double, lng: Double)? {
        guard let a = defaults?.array(forKey: Key.fix) as? [Double], a.count == 3,
              nowMs() - a[2] < maxAge * 1000 else { return nil }
        return (a[0], a[1])
    }

    // Monotonic per-device event number. Survives restarts and log clears, so a later sync can
    // de-duplicate on it.
    static func nextSeq() -> Int {
        let n = int(Key.seq) + 1
        set(Key.seq, n)
        return n
    }

    // v2: postcodes only, never street addresses. Logs written before that are wiped once.
    static let currentLogVersion = 2

    static func int(_ key: String) -> Int { defaults?.integer(forKey: key) ?? 0 }

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
            "passedGate": d.integer(forKey: Key.passedGate),
            "runOrders": d.integer(forKey: Key.runOrders),
            "lastVerdict": d.string(forKey: Key.lastVerdict) ?? "",
            "authState": d.string(forKey: Key.authState) ?? "",
            "ocrPasses": d.integer(forKey: Key.ocrPasses),
            "events": d.integer(forKey: Key.events),
            "peakMB": d.double(forKey: Key.peakMB),
            "lastMB": d.double(forKey: Key.lastMB),
        ]
    }
}
