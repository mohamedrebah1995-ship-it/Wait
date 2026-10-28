import Foundation
import Security

// Firebase sign-in for /evaluate, shared by the app and the extension through the keychain. The App
// Group doubles as a keychain access group, so both targets read the same item without extra
// entitlements, and other keychain items keep their default group. Member of BOTH targets.
//
// The app stores the refresh token whenever Firebase hands it a new ID token. The extension mints
// fresh ID tokens from it (Google securetoken API), so verdicts keep working for a whole shift without
// reopening the app.
enum SharedAuth {
    static let accessGroup = ScreenReaderStore.appGroup
    private static let service = "app.delivr.mobile.evaluate"
    private static let account = "firebase"

    struct Tokens: Codable {
        var refreshToken: String
        var idToken: String
        var expiresAt: Double       // epoch ms
        var apiKey: String          // Firebase web API key (public; identifies the project to securetoken)
    }

    private static func base() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrAccessGroup as String: accessGroup]
    }

    // nil deletes the item (signed out). Returns whether the keychain accepted the write.
    @discardableResult
    static func save(_ t: Tokens?) -> Bool {
        SecItemDelete(base() as CFDictionary)
        guard let t = t, let data = try? JSONEncoder().encode(t) else { return t == nil }
        var q = base()
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock   // the extension runs with the phone in use
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> Tokens? {
        var q = base()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Tokens.self, from: data)
    }
}

enum TokenResult: Equatable {
    case token(String)
    case offline        // couldn't reach Google: offline estimate, no warning
    case reconnect      // signed out, or the refresh token was rejected: the driver must open the app
}

// Hands out an ID token with at least 5 minutes left, refreshing it when needed. Storage and network
// are injectable so the Mac test can drive it without a keychain or the internet.
struct TokenProvider {
    var load: () -> SharedAuth.Tokens? = SharedAuth.load
    var save: (SharedAuth.Tokens) -> Void = { SharedAuth.save($0) }
    var post: (URLRequest) -> (Data?, Int?) = TokenProvider.syncPost   // status nil = network failure
    var now: () -> Date = Date.init
    var timeout: TimeInterval = 3
    var minRemainingMs = 5 * 60 * 1000.0       // refresh when less than this is left

    func idToken() -> TokenResult {
        guard var t = load(), !t.refreshToken.isEmpty else { return record(.reconnect) }
        let nowMs = now().timeIntervalSince1970 * 1000
        if t.expiresAt - nowMs > minRemainingMs { return record(.token(t.idToken)) }

        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        guard let rt = t.refreshToken.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(t.apiKey)") else { return record(.reconnect) }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = "grant_type=refresh_token&refresh_token=\(rt)".data(using: .utf8)

        let (data, status) = post(req)
        guard let status = status else { return record(.offline) }
        guard status == 200, let data = data,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = json["id_token"] as? String else {
            // 400/401/403: refresh token revoked/expired, user disabled, password changed. Anything else
            // (5xx) is Google having a moment: treat as offline.
            return record((400..<404).contains(status) ? .reconnect : .offline)
        }
        t.idToken = id
        if let r = json["refresh_token"] as? String, !r.isEmpty { t.refreshToken = r }
        let life = Double((json["expires_in"] as? String) ?? "") ?? 3600
        t.expiresAt = nowMs + life * 1000
        save(t)
        return record(.token(id))
    }

    // Debug sheet: "ok" / "offline" / "reconnect".
    private func record(_ r: TokenResult) -> TokenResult {
        let s: String
        switch r { case .token: s = "ok"; case .offline: s = "offline"; case .reconnect: s = "reconnect" }
        ScreenReaderStore.set(ScreenReaderStore.Key.authState, s)
        return r
    }

    static func syncPost(_ req: URLRequest) -> (Data?, Int?) {
        var result: (Data?, Int?) = (nil, nil)
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            result = (data, (resp as? HTTPURLResponse)?.statusCode)
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + req.timeoutInterval + 0.5)
        return result
    }
}
