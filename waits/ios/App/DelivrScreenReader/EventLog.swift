import Foundation

// Append-only JSON-lines log of detected events in the App Group. One event per line, no images, no
// customer names. Written by the extension, read by the app. Member of BOTH targets.
enum EventLog {
    static let fileName = "screen-events.jsonl"

    static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ScreenReaderStore.appGroup)?
            .appendingPathComponent(fileName)
    }

    static func append<T: Encodable>(_ event: T) {
        guard let url = url else { return }
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .millisecondsSince1970
        guard var data = try? enc.encode(event) else { return }
        data.append(0x0A)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: data)
            return
        }
        guard let h = try? FileHandle(forWritingTo: url) else { return }
        defer { try? h.close() }
        _ = try? h.seekToEnd()
        try? h.write(contentsOf: data)
    }

    static func clear() {
        guard let url = url else { return }
        try? FileManager.default.removeItem(at: url)
    }

    // Newest last. Reads only the tail of the file, so a long shift's log stays cheap to read.
    static func last(_ n: Int) -> [[String: Any]] {
        guard let url = url, let h = try? FileHandle(forReadingFrom: url) else { return [] }
        defer { try? h.close() }
        let size = (try? h.seekToEnd()) ?? 0
        let tail: UInt64 = 32 * 1024
        try? h.seek(toOffset: size > tail ? size - tail : 0)
        guard let data = try? h.readToEnd(), let text = String(data: data, encoding: .utf8) else { return [] }
        let lines = text.split(separator: "\n").suffix(n)
        return lines.compactMap {
            (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any]
        }
    }
}
