import Foundation
import JavaScriptCore
import UserNotifications
import AudioToolbox

// Every NEW_OFFER → verdict notification. IDLE: solo £/hr (on the device for Uber/Just Eat). ACTIVE:
// stacking verdict.
//   1. POST /evaluate (live Mapbox times on the server), 3s budget.
//   2. Otherwise an on-device estimate: the SAME engine (StackEngine.js, generated from
//      src/stackEngine.js) run in JavaScriptCore on straight-line times, labelled "Offline estimate".
// Only postcodes, restaurant names, pay, minutes and miles (+ picked-up flags) leave the phone.
final class OfferEvaluator {
    static let timeout: TimeInterval = 3
    private let queue = DispatchQueue(label: "delivr.evaluate")
    private var engine: JSValue?           // StackEngine, created on first offline estimate
    private var context: JSContext?
    private let resourceDir: URL?          // nil = the extension bundle; a folder for the Mac test
    private var tokens = TokenProvider()

    init(resourceDir: URL? = nil) { self.resourceDir = resourceDir }

    private func resource(_ name: String, _ ext: String) -> URL? {
        resourceDir.map { $0.appendingPathComponent("\(name).\(ext)") } ?? Bundle(for: OfferEvaluator.self).url(forResource: name, withExtension: ext)
    }

    private lazy var districts: [String: [Double]] = {
        guard let url = resource("PostcodeDistricts", "json"),
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return (obj["districts"] as? [String: [Double]]) ?? [:]
    }()

    func evaluate(offer: ScreenEvent, run: [RunOrder]) {
        queue.async { self.run(offer: offer, run: run) }
    }

    // MARK: - flow

    static let reconnectText = "Open MOdelivr to reconnect"

    // Every NEW_OFFER gets a verdict: solo ("is it worth it") while IDLE, stacking while a run is active.
    // Offer flags are always appended.
    func verdictText(offer: ScreenEvent, run: [RunOrder]) -> String {
        let verdict = run.isEmpty ? soloVerdict(offer) : stackVerdict(offer: offer, run: run)
        var flags = offer.flags
        if offer.offerType == OfferType.package { flags.append(OfferType.package) }
        let text = loadEngine()?.invokeMethod("appendFlags", withArguments: [verdict, flags])?.toString() ?? verdict
        return run.isEmpty ? text : text + "\n" + Self.runSummary(run)
    }

    // Names the run a stacking verdict was judged against, so a wrong run is obvious (End run in the app).
    static func runSummary(_ run: [RunOrder]) -> String {
        "Your run: " + run.map { $0.restaurant ?? platformName($0.platform) }.joined(separator: ", ")
    }

    // One notification and one chime per order. OCR reads the same card slightly differently from frame
    // to frame (miles, name, a missing postcode), so the order is keyed on platform + pay — the headline,
    // read most reliably. A later frame only matters if it brings the drop-off postcode the first lacked;
    // then the same notification is updated in place, silently.
    private var notified: [String: (at: Date, hadPostcode: Bool)] = [:]

    static func orderKey(_ e: ScreenEvent) -> String {
        e.platform.rawValue + "|" + (e.pay.map { String(format: "%.2f", $0) } ?? e.restaurant ?? "")
    }

    private func run(offer: ScreenEvent, run: [RunOrder]) {
        let key = Self.orderKey(offer), now = Date()
        notified = notified.filter { now.timeIntervalSince($0.value.at) < 5 * 60 }
        let seen = notified[key]
        if let s = seen, s.hadPostcode || offer.dropPostcode == nil { return }
        notified[key] = (now, offer.dropPostcode != nil)
        notify(verdictText(offer: offer, run: run), offer: offer, key: key, alert: seen == nil)
    }

    private func liveBody(offer: ScreenEvent, run: [RunOrder]) -> [String: Any] {
        var body: [String: Any] = ["offer": Self.wire(offer), "run": run.map(Self.wire), "minRate": ScreenReaderStore.minRate()]
        // The driver's own position (rounded ~100 m) when the app had a fix in the last 2 minutes.
        if let f = ScreenReaderStore.freshFix() { body["here"] = ["lat": f.lat, "lng": f.lng] }
        return body
    }

    // ACTIVE: /evaluate (3s), else the on-device estimate. A sign-in problem is said, never swallowed.
    private func stackVerdict(offer: ScreenEvent, run: [RunOrder]) -> String {
        let live = postEvaluate(liveBody(offer: offer, run: run))
        if case .verdict(let reply) = live, let text = reply["text"] as? String {
            rememberLocations(reply, offer: offer, run: run)
            return text
        }
        let estimate = offlineEstimate(offer: offer, run: run)
        if live == .reconnect { return estimate.map { "\($0)\n\(Self.reconnectText)" } ?? Self.reconnectText }
        return estimate ?? Self.cantCheck(offer)
    }

    // Says which it was: no postcode read off the card, or one the phone couldn't place without signal.
    static func cantCheck(_ offer: ScreenEvent) -> String {
        guard let pc = offer.dropPostcode else { return "Can't check this offer: no drop-off postcode on the card" }
        return "Offline: can't place \(pc) yet — needs signal"
    }

    // IDLE: Uber and Just Eat cards give the trip time, so this needs no network at all. Deliveroo cards
    // don't: /evaluate routes it (3s), else an offline estimate.
    func soloVerdict(_ offer: ScreenEvent) -> String {
        if let minutes = Self.tripMinutes(offer), let text = solo(pay: offer.pay, minutes: minutes, miles: offer.miles, offline: false) { return text }
        let live = postEvaluate(liveBody(offer: offer, run: []))
        if case .verdict(let reply) = live, let text = reply["text"] as? String {
            rememberLocations(reply, offer: offer, run: [])
            return text
        }
        let estimate = offlineSoloEstimate(offer)
        if live == .reconnect { return estimate.map { "\($0)\n\(Self.reconnectText)" } ?? Self.reconnectText }
        return estimate ?? Self.cantCheck(offer)
    }

    // Trip minutes from the card: Uber prints them; Just Eat prints the drop-off ETA (minutes = ETA − when
    // the offer appeared), else miles at average speed. Deliveroo prints neither → nil.
    static func tripMinutes(_ e: ScreenEvent) -> Double? {
        if let m = e.minutes, m > 0 { return Double(m) }
        if let eta = e.dropETA, let m = minutesUntil(eta, from: e.at) { return m }
        if let mi = e.miles, mi > 0 { return mi * 1609.34 / 8.3 / 60 }
        return nil
    }

    static func minutesUntil(_ eta: String, from start: Date) -> Double? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "h:mm a"
        guard let t = f.date(from: eta.uppercased()) else { return nil }
        let cal = Calendar.current
        let hm = cal.dateComponents([.hour, .minute], from: t)
        guard var when = cal.date(bySettingHour: hm.hour ?? 0, minute: hm.minute ?? 0, second: 0, of: start) else { return nil }
        if when < start.addingTimeInterval(-5 * 60) { when = when.addingTimeInterval(24 * 3600) }   // ETA past midnight
        let m = when.timeIntervalSince(start) / 60
        return m > 0 && m < 180 ? m : nil
    }

    // With the card's miles the verdict is £/mile (the app's own time estimate is ignored); else £/hr.
    private func solo(pay: Double?, minutes: Double, miles: Double? = nil, offline: Bool) -> String? {
        guard let engine = loadEngine(), let pay = pay else { return nil }
        var opts: [String: Any] = ["minRate": ScreenReaderStore.minRate(), "offline": offline]
        if let mi = miles, mi > 0 { opts["miles"] = mi }
        let r = engine.invokeMethod("judgeSolo", withArguments: [pay, minutes, opts])
        return r?.isObject == true ? r?.forProperty("text").toString() : nil
    }

    // Deliveroo with no signal: straight-line route (driver → pickup → drop-off) at average speed.
    func offlineSoloEstimate(_ offer: ScreenEvent) -> String? {
        let cache = GeoCache.load()
        guard let d = coord(postcode: offer.dropPostcode, cache: cache) else { return nil }
        let p = coord(postcode: offer.pickupPostcode, cache: cache) ?? offer.restaurant.flatMap { cache.restaurants[$0.lowercased()] } ?? d
        let drop = ["lat": d[0], "lng": d[1]], pickup = ["lat": p[0], "lng": p[1]]
        var metres = Self.haversine(pickup, drop)
        if let f = ScreenReaderStore.freshFix() { metres += Self.haversine(["lat": f.lat, "lng": f.lng], pickup) }
        return solo(pay: offer.pay, minutes: metres * 1.3 / 8.3 / 60, offline: true)
    }

    // Called about once a minute while broadcasting: renews the ID token when it has < 10 min left, so an
    // offer never waits on Google.
    func refreshTokenIfDue() {
        queue.async { var t = self.tokens; t.minRemainingMs = 10 * 60 * 1000; _ = t.idToken() }
    }

    // The privacy contract: these fields and nothing else.
    private static func wire(_ e: ScreenEvent) -> [String: Any] {
        compact(["restaurant": e.restaurant, "pickupPostcode": e.pickupPostcode, "dropPostcode": e.dropPostcode,
                 "pay": e.pay, "minutes": e.minutes, "miles": e.miles, "pickedUp": false])
    }
    private static func wire(_ o: RunOrder) -> [String: Any] {
        compact(["restaurant": o.restaurant, "pickupPostcode": o.pickupPostcode, "dropPostcode": o.dropPostcode,
                 "pay": o.pay, "minutes": o.minutes, "miles": o.miles, "pickedUp": o.pickedUp])
    }
    private static func compact(_ d: [String: Any?]) -> [String: Any] { d.compactMapValues { $0 } }

    // MARK: - run events → server (waits, "waiting now", earnings)

    // Accepted / arrived / picked up / delivered / cancelled go to /screen-event so the driver's waits and
    // earnings are logged live. One that can't be sent (no signal at the restaurant) waits in a small outbox
    // in the App Group and goes with the next; each carries the time it was seen, so late is still exact.
    func report(_ e: ScreenEvent, order: RunOrder) {
        var body = Self.compact(["type": e.type.rawValue, "platform": e.platform.rawValue, "orderId": order.id,
                                 "at": e.at.timeIntervalSince1970 * 1000, "restaurant": order.restaurant ?? e.restaurant,
                                 "pickupPostcode": order.pickupPostcode, "dropPostcode": order.dropPostcode, "pay": order.pay])
        if let f = ScreenReaderStore.freshFix() { body["here"] = ["lat": f.lat, "lng": f.lng] }
        queue.async {
            var outbox = Self.outbox + [body]
            while let next = outbox.first, self.postEvent(next) { outbox.removeFirst() }
            Self.outbox = Array(outbox.suffix(30))
        }
    }

    // Retry what's waiting (called about once a minute while broadcasting).
    func flushOutbox() {
        queue.async {
            var outbox = Self.outbox
            guard !outbox.isEmpty else { return }
            while let next = outbox.first, self.postEvent(next) { outbox.removeFirst() }
            Self.outbox = outbox
        }
    }

    private static var outbox: [[String: Any]] {
        get { UserDefaults(suiteName: ScreenReaderStore.appGroup)?.array(forKey: "sr.outbox") as? [[String: Any]] ?? [] }
        set { UserDefaults(suiteName: ScreenReaderStore.appGroup)?.set(newValue, forKey: "sr.outbox") }
    }

    // True when the event is done with: accepted, or refused for good (a bad event never gets better).
    // False keeps it for a retry: no signal, no sign-in, rate limit, server trouble.
    private func postEvent(_ body: [String: Any]) -> Bool {
        guard let base = UserDefaults(suiteName: ScreenReaderStore.appGroup)?.string(forKey: ScreenReaderStore.Key.evalURL), !base.isEmpty,
              let url = URL(string: base + "/screen-event"),
              let json = try? JSONSerialization.data(withJSONObject: body),
              case .token(let token) = tokens.idToken() else { return false }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.httpBody = json
        let (_, status) = TokenProvider.syncPost(req)
        guard let s = status else { return false }
        return s == 200 || s == 400
    }

    // MARK: - live

    enum LiveResult: Equatable {
        case verdict([String: Any])
        case reconnect          // no usable sign-in: tell the driver
        case unavailable        // offline, timeout, server error

        static func == (a: LiveResult, b: LiveResult) -> Bool {
            switch (a, b) { case (.reconnect, .reconnect), (.unavailable, .unavailable), (.verdict, .verdict): return true; default: return false }
        }
    }

    private func postEvaluate(_ body: [String: Any]) -> LiveResult {
        let started = Date()
        guard let base = UserDefaults(suiteName: ScreenReaderStore.appGroup)?.string(forKey: ScreenReaderStore.Key.evalURL), !base.isEmpty,
              let url = URL(string: base + "/evaluate"),
              let json = try? JSONSerialization.data(withJSONObject: body) else { return .unavailable }
        let token: String
        switch tokens.idToken() {
        case .token(let t): token = t
        case .reconnect: return .reconnect
        case .offline: return .unavailable
        }
        // Whatever the token refresh used comes out of the same 3s budget.
        let left = Self.timeout - Date().timeIntervalSince(started)
        guard left > 0.3 else { return .unavailable }
        var req = URLRequest(url: url, timeoutInterval: left)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.httpBody = json
        let (data, status) = TokenProvider.syncPost(req)
        if status == 401 { return .reconnect }
        guard status == 200, let data = data,
              let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .unavailable }
        return .verdict(reply)
    }

    // Coordinates the server resolved, cached for later offline estimates (postcode / restaurant → lat,lng).
    private func rememberLocations(_ live: [String: Any]?, offer: ScreenEvent, run: [RunOrder]) {
        guard let located = live?["located"] as? [String: Any] else { return }
        var cache = GeoCache.load()
        let pairs: [(String?, String?, String?, Any?)] =
            run.enumerated().map { (i, o) in (o.dropPostcode, o.pickupPostcode, o.restaurant, (located["run"] as? [Any])?[safe: i]) }
            + [(offer.dropPostcode, offer.pickupPostcode, offer.restaurant, located["offer"])]
        for (drop, pickupPC, name, loc) in pairs {
            guard let loc = loc as? [String: Any] else { continue }
            if let pc = drop, let c = GeoCache.coord(loc["drop"]) { cache.postcodes[pc] = c }
            if let p = GeoCache.coord(loc["pickup"]) {
                if let pc = pickupPC { cache.postcodes[pc] = p }
                if let n = name { cache.restaurants[n.lowercased()] = p }
            }
        }
        cache.save()
    }

    // MARK: - offline estimate

    private func coord(postcode: String?, cache: GeoCache) -> [Double]? {
        guard let pc = postcode else { return nil }
        if let c = cache.postcodes[pc] { return c }
        return districts[String(pc.split(separator: " ").first ?? "")]
    }

    func offlineEstimate(offer: ScreenEvent, run: [RunOrder]) -> String? {
        let cache = GeoCache.load()
        func place(drop: String?, pickupPC: String?, name: String?, pickedUp: Bool, pay: Double?) -> [String: Any]? {
            guard let d = coord(postcode: drop, cache: cache) else { return nil }
            let p = pickedUp ? nil : (coord(postcode: pickupPC, cache: cache) ?? name.flatMap { cache.restaurants[$0.lowercased()] } ?? d)
            var o: [String: Any] = ["drop": ["lat": d[0], "lng": d[1]], "pay": pay ?? 0]
            o["pickup"] = p.map { ["lat": $0[0], "lng": $0[1]] } ?? NSNull()
            return o
        }
        // A run order with no usable postcode is left out (and said so) rather than blocking the check.
        let runList = run.compactMap { place(drop: $0.dropPostcode, pickupPC: $0.pickupPostcode, name: $0.restaurant, pickedUp: $0.pickedUp, pay: $0.pay) }
        guard let offerPlaced = place(drop: offer.dropPostcode, pickupPC: offer.pickupPostcode, name: offer.restaurant, pickedUp: false, pay: offer.pay),
              !runList.isEmpty else { return nil }
        let skipped = run.count - runList.count
        let first = runList[0]
        // Start: the driver's fresh fix, else the run's next stop (same rule as /evaluate).
        let start = ScreenReaderStore.freshFix().map { ["lat": $0.lat, "lng": $0.lng] }
            ?? (first["pickup"] as? [String: Double]) ?? (first["drop"] as! [String: Double])

        guard let engine = loadEngine(),
              let built = engine.invokeMethod("buildOfferStack", withArguments: [start, runList, offerPlaced]),
              let points = built.forProperty("points").toArray() as? [[String: Double]] else { return nil }
        let matrix = Self.estimateMatrix(points)
        let verdict = engine.invokeMethod("judgeOffer", withArguments: [matrix, built.forProperty("orders") as Any,
                                                                         ["offline": true, "minRate": ScreenReaderStore.minRate()]])
        return verdict?.forProperty("text").toString().map { $0 + Self.skippedNote(skipped) }
    }

    static func skippedNote(_ n: Int) -> String { n > 0 ? " · \(n) order\(n == 1 ? "" : "s") without a postcode left out" : "" }

    // Straight-line × road factor ÷ average urban speed: the same rule as the app's routeCache.
    private static func estimateMatrix(_ pts: [[String: Double]]) -> [String: [[Double]]] {
        let roadFactor = 1.3, speed = 8.3
        var dur: [[Double]] = [], dist: [[Double]] = []
        for a in pts {
            var dr: [Double] = [], ds: [Double] = []
            for b in pts {
                let m = haversine(a, b) * roadFactor
                ds.append(m); dr.append(m / speed)
            }
            dur.append(dr); dist.append(ds)
        }
        return ["dur": dur, "dist": dist]
    }

    private static func haversine(_ a: [String: Double], _ b: [String: Double]) -> Double {
        let r = 6371000.0, rad = Double.pi / 180
        let la1 = (a["lat"] ?? 0) * rad, la2 = (b["lat"] ?? 0) * rad
        let dLat = la2 - la1, dLng = ((b["lng"] ?? 0) - (a["lng"] ?? 0)) * rad
        let s = sin(dLat / 2) * sin(dLat / 2) + cos(la1) * cos(la2) * sin(dLng / 2) * sin(dLng / 2)
        return r * 2 * atan2(sqrt(s), sqrt(1 - s))
    }

    private func loadEngine() -> JSValue? {
        if let e = engine { return e }
        guard let url = resource("StackEngine", "js"),
              let src = try? String(contentsOf: url), let ctx = JSContext() else { return nil }
        ctx.evaluateScript(src)
        context = ctx
        engine = ctx.objectForKeyedSubscript("StackEngine")
        return engine?.isUndefined == false ? engine : nil
    }

    // MARK: - notification

    static func platformName(_ p: Platform) -> String {
        switch p { case .uber: return "Uber Eats"; case .justEat: return "Just Eat"; case .deliveroo: return "Deliveroo" }
    }

    // The verdict notification (one per order: the id is the order key, so an update replaces it).
    // iOS silences notification sounds and banners while the screen is recorded — which is always, here —
    // so the extension plays the Delivr chime and vibrates itself. `alert` is false for a silent update.
    private func notify(_ text: String, offer: ScreenEvent, key: String, alert: Bool) {
        let c = UNMutableNotificationContent()
        c.title = "Delivr · " + Self.platformName(offer.platform)
        c.body = text
        _ = Self.installSound
        c.sound = alert ? UNNotificationSound(named: UNNotificationSoundName("delivr_offer.caf")) : nil
        c.interruptionLevel = .active   // broadcast extensions can't hold the time-sensitive entitlement
        let req = UNNotificationRequest(identifier: "offer|" + key, content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req)
        if alert { AudioServicesPlayAlertSound(Self.chime) }   // sound + vibration; vibration only on silent
        ScreenReaderStore.set(ScreenReaderStore.Key.lastVerdict, text)
    }

    private static let chime: SystemSoundID = {
        var id = SystemSoundID(kSystemSoundID_Vibrate)
        if let url = Bundle.main.url(forResource: "delivr_offer", withExtension: "caf") {
            AudioServicesCreateSystemSoundID(url as CFURL, &id)
        }
        return id
    }()

    // Copy the chime into the App Group's Library/Sounds once — a sound named by a notification an
    // extension posts is looked up there as well as in bundles, so this works either way.
    private static let installSound: Void = {
        let fm = FileManager.default
        guard let src = Bundle.main.url(forResource: "delivr_offer", withExtension: "caf"),
              let dir = fm.containerURL(forSecurityApplicationGroupIdentifier: ScreenReaderStore.appGroup)?
                .appendingPathComponent("Library/Sounds", isDirectory: true) else { return }
        let dst = dir.appendingPathComponent("delivr_offer.caf")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try? fm.removeItem(at: dst)
        try? fm.copyItem(at: src, to: dst)
    }()
}

// Postcode / restaurant → coordinates learned from /evaluate replies. App Group, device only.
struct GeoCache: Codable {
    var postcodes: [String: [Double]] = [:]
    var restaurants: [String: [Double]] = [:]

    private static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ScreenReaderStore.appGroup)?
            .appendingPathComponent("geo-cache.json")
    }
    static func load() -> GeoCache {
        guard let url = url, let d = try? Data(contentsOf: url), let c = try? JSONDecoder().decode(GeoCache.self, from: d) else { return GeoCache() }
        return c
    }
    func save() {
        guard let url = Self.url, let d = try? JSONEncoder().encode(self) else { return }
        try? d.write(to: url, options: .atomic)
    }
    static func coord(_ v: Any?) -> [Double]? {
        guard let o = v as? [String: Any], let lat = o["lat"] as? Double, let lng = o["lng"] as? Double else { return nil }
        return [lat, lng]
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
