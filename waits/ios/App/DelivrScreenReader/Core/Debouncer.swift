import Foundation

// The same screen across several frames (or re-shown after a quick app switch) is one event.
// An event is emitted only if its key wasn't emitted in the last `window` seconds.
struct Debouncer {
    var window: TimeInterval = 10 * 60
    private var seen: [String: Date] = [:]

    init(window: TimeInterval = 10 * 60) { self.window = window }

    mutating func accept(_ e: ScreenEvent) -> Bool {
        seen = seen.filter { e.at.timeIntervalSince($0.value) < window }
        if seen[e.dedupeKey] != nil { return false }
        seen[e.dedupeKey] = e.at
        return true
    }
}
