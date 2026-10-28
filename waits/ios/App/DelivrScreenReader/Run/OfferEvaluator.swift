import Foundation
import JavaScriptCore
import UserNotifications

// NEW_OFFER during a run → verdict notification.
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

    private func run(offer: ScreenEvent, run: [RunOrder]) {
        let body: [String: Any] = ["offer": Self.wire(offer), "run": run.map(Self.wire)]
        let live = postEvaluate(body)
        if let text = live?["text"] as? String {
            rememberLocations(live, offer: offer, run: run)
            notify(text, id: offer.seq)
            return
        }
        if let text = offlineEstimate(offer: offer, run: run) {
            notify(text, id: offer.seq)
        } else {
            notify("Offline: can't check this offer (no drop-off postcode on the card)", id: offer.seq)
        }
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

    // MARK: - live

    private func postEvaluate(_ body: [String: Any]) -> [String: Any]? {
        let d = UserDefaults(suiteName: ScreenReaderStore.appGroup)
        guard let base = d?.string(forKey: ScreenReaderStore.Key.evalURL), !base.isEmpty,
              let token = d?.string(forKey: ScreenReaderStore.Key.evalToken), !token.isEmpty,
              let url = URL(string: base + "/evaluate"),
              let json = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        var req = URLRequest(url: url, timeoutInterval: Self.timeout)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.httpBody = json
        var result: [String: Any]?
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            if (resp as? HTTPURLResponse)?.statusCode == 200, let data = data {
                result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            }
            done.signal()
        }.resume()
        return done.wait(timeout: .now() + Self.timeout) == .success ? result : nil
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
        let runPlaced = run.map { place(drop: $0.dropPostcode, pickupPC: $0.pickupPostcode, name: $0.restaurant, pickedUp: $0.pickedUp, pay: $0.pay) }
        guard let offerPlaced = place(drop: offer.dropPostcode, pickupPC: offer.pickupPostcode, name: offer.restaurant, pickedUp: false, pay: offer.pay),
              !runPlaced.isEmpty, !runPlaced.contains(where: { $0 == nil }) else { return nil }
        let runList = runPlaced.compactMap { $0 }
        let first = runList[0]
        let start = (first["pickup"] as? [String: Double]) ?? (first["drop"] as! [String: Double])

        guard let engine = loadEngine(),
              let built = engine.invokeMethod("buildOfferStack", withArguments: [start, runList, offerPlaced]),
              let points = built.forProperty("points").toArray() as? [[String: Double]] else { return nil }
        let matrix = Self.estimateMatrix(points)
        let verdict = engine.invokeMethod("judgeOffer", withArguments: [matrix, built.forProperty("orders") as Any, ["offline": true]])
        return verdict?.forProperty("text").toString()
    }

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

    private func notify(_ text: String, id: Int?) {
        let c = UNMutableNotificationContent()
        c.title = "Offer check"
        c.body = text
        c.sound = .default
        let req = UNNotificationRequest(identifier: "offer-\(id ?? Int(Date().timeIntervalSince1970))", content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req)
        ScreenReaderStore.set(ScreenReaderStore.Key.lastVerdict, text)
    }
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
