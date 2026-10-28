import Foundation
import CoreGraphics

// Platform detection, classifier and parser. Text rules only (no ML); button colour breaks ties.
// To add a platform: add its markers to PlatformDetector and a rules enum with classify + parse.

// MARK: - Screen text helpers

struct ScreenText {
    let lines: [OCRLine]
    let lower: [String]

    init(_ lines: [OCRLine]) {
        self.lines = lines
        self.lower = lines.map {
            $0.text.lowercased()
                .replacingOccurrences(of: "\u{2019}", with: "'")
                .replacingOccurrences(of: "\u{2018}", with: "'")
        }
    }

    func has(_ s: String) -> Bool { lower.contains { $0.contains(s) } }

    // Whole line equals `s`, ignoring stray punctuation/bullets OCR attaches to buttons.
    func hasLine(_ s: String) -> Bool { firstIndex(line: s) != nil }

    func firstIndex(line s: String) -> Int? {
        lower.firstIndex { $0.trimmingCharacters(in: Self.junk) == s }
    }

    func firstIndex(containing s: String, after: Int = -1) -> Int? {
        lower.indices.first { $0 > after && lower[$0].contains(s) }
    }

    func firstIndex(matching pattern: String, after: Int = -1) -> Int? {
        lower.indices.first { $0 > after && Rx.match(pattern, lower[$0]) != nil }
    }

    // First following line that looks like real text (OCR scatters 1–2 char fragments from map labels).
    func nextTextLine(after i: Int, minX: CGFloat = 0.05) -> Int? {
        lines.indices.first { $0 > i && lines[$0].text.count >= 3 && lines[$0].box.minX >= minX }
    }

    static let junk = CharacterSet.whitespaces.union(.punctuationCharacters).union(CharacterSet(charactersIn: "•·*&@©®"))
}

enum Rx {
    // Capture groups of the first match (index 0 = whole match), or nil.
    static func match(_ pattern: String, _ s: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            Range(m.range(at: i), in: s).map { String(s[$0]) } ?? ""
        }
    }

    static func all(_ pattern: String, _ s: String) -> [[String]] {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        return re.matches(in: s, range: NSRange(s.startIndex..., in: s)).map { m in
            (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
        }
    }
}

enum Parse {
    static func number(_ s: String) -> Double? { Double(s.replacingOccurrences(of: ",", with: ".")) }

    // UK postcode, tolerating OCR dropping the space ("CM778EZ" → "CM77 8EZ").
    static func postcode(_ s: String) -> String? {
        guard let m = Rx.match(#"\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s?([0-9][A-Z]{2})\b"#, s.uppercased()) else { return nil }
        return "\(m[1]) \(m[2])"
    }

    // The headline pay is the tallest "£x.xx" on screen ("€" accepted: OCR confuses the two on small text). Returns (amount, isAddOn "+£").
    static func headlinePay(_ s: ScreenText, near row: Int? = nil) -> (Double, Bool)? {
        var best: (Double, Bool, CGFloat)?
        for (i, line) in s.lines.enumerated() {
            guard let m = Rx.match(#"(\+)?\s*[£€]\s*([0-9]{1,3}[.,][0-9]{2})"#, line.text), let v = number(m[2]) else { continue }
            if let row = row, abs(s.lines[row].box.midY - line.box.midY) > 0.025 { _ = i; continue }
            if best == nil || line.box.height > best!.2 { best = (v, m[1] == "+", line.box.height) }
        }
        return best.map { ($0.0, $0.1) }
    }

    static func cleanName(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "•", with: "-")
        t = t.replacingOccurrences(of: #"\s*-\s*"#, with: " - ", options: .regularExpression)
        t = t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return t.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: "-")))
    }

    // "2:31 PM" / "3:21PM" → "2:31 PM"
    static func eta(_ s: String) -> String {
        s.uppercased().replacingOccurrences(of: #"\s*([AP]M)"#, with: " $1", options: .regularExpression)
    }

    static func flags(_ s: ScreenText) -> [String] {
        var f: [String] = []
        if s.has("exclusive") { f.append(Flag.exclusive) }
        if s.has("must verify id") { f.append(Flag.mustVerifyID) }
        if s.has("customer verification") { f.append(Flag.customerVerification) }
        if s.has("age-restricted") || s.has("age restricted") { f.append(Flag.ageRestricted) }
        if s.has("includes bonus") { f.append(Flag.includesBonus) }
        if s.has("heavy") { f.append(Flag.heavy) }                      // Uber "Heavy order"; no fixture yet
        return f
    }

    // Cancellation is phrased differently per app and we have no fixtures yet — kept deliberately narrow.
    static func cancelled(_ s: ScreenText) -> Bool {
        s.lower.contains { l in
            (l.contains("cancelled") || l.contains("canceled")) &&
            (l.contains("order") || l.contains("trip") || l.contains("delivery"))
        }
    }

    static func cancellationFee(_ s: ScreenText) -> Double? {
        guard let i = s.firstIndex(containing: "cancellation fee"),
              let m = Rx.match(#"[£€]\s*([0-9]{1,3}[.,][0-9]{2})"#, s.lines[i].text) else { return nil }
        return number(m[1])
    }

    // True for text that reads as a street address rather than a business name: a postcode, a leading
    // house number ("12 High St"), "Flat 3" / "Unit 2", or a street word next to a number.
    // Business names with digits ("Five Guys", "Pizza 2 Go") pass, since they have none of these.
    static func isAddressLike(_ s: String) -> Bool {
        if postcode(s) != nil { return true }
        let l = s.lowercased()
        if Rx.match(#"^\s*\d+[a-z]?\s+[a-z]"#, l) != nil { return true }     // "12 High St", not "7-Eleven"
        if Rx.match(#"\b(flat|unit|apartment|apt|house|suite|block)\s*\d"#, l) != nil { return true }
        let street = #"\b(road|rd|street|st|close|cl|avenue|ave|lane|ln|way|crescent|cres|drive|dr|court|ct|gardens|gdns|place|pl|terrace|grove|mews|row|square|sq|park|hill|walk)\b"#
        return Rx.match(street, l) != nil && l.contains(where: \.isNumber)
    }
}

// MARK: - Platform detection

enum Accent { case green, teal, orange }

enum PlatformDetector {
    // Lowercased substrings; "=" prefix = whole line; "~" prefix = regex.
    static let markers: [(Platform, [String])] = [
        (.uber, ["uber", "trip guide", "finding trips", "stop new requests", "waybill", "complete pick-up",
                 "you're online", "you're offline", "trip radar", "leave at door", "=confirm",
                 #"~\d+\s*min\s*\(.*mi\)\s*total"#, #"~^pick up \d+ orders?"#, #"~^drop off \d+ orders?"#,
                 "pick-up •", "drop-off •"]),
        (.justEat, ["accept offer", "includes bonus", "navigate to business", "navigate to customer",
                    #"~^\d+\s*pickups?:"#, #"~^\d+\s*deliver(y|ies):"#, "i've arrived", "picked up order",
                    "starting route", "delivery code required", "delivery code is valid", "enter delivery code",
                    "offer declined", "decline offer", "are you sure?", "pick up at", "scheduling"]),
        (.deliveroo, ["accept and go", "go to restaurant", #"~travel .* to collect"#, #"~travel .* to customer"#,
                      "find the tag", "check in now", "how to check in", "collect order", "tick orders",
                      "go to customer", "find customer", "confirm delivery", "finding orders for you",
                      "total fee", "deliveroo", "=arrived"]),
    ]

    static func score(_ s: ScreenText, _ list: [String]) -> Int {
        list.reduce(0) { n, m in
            if m.hasPrefix("=") { return n + (s.hasLine(String(m.dropFirst())) ? 1 : 0) }
            if m.hasPrefix("~") { return n + (s.firstIndex(matching: String(m.dropFirst())) != nil ? 1 : 0) }
            return n + (s.has(m) ? 1 : 0)
        }
    }

    // Returns the platform and whether the colour tiebreak was needed.
    static func detect(_ s: ScreenText, accent: Accent?) -> (Platform, usedColour: Bool)? {
        let scored = markers.map { ($0.0, score(s, $0.1)) }.sorted { $0.1 > $1.1 }
        guard let top = scored.first, top.1 > 0 else { return nil }
        if scored.count > 1, scored[1].1 == top.1 {
            let byColour: Platform? = accent.map { [.green: .uber, .teal: .deliveroo, .orange: .justEat][$0]! }
            if let p = byColour, scored.contains(where: { $0.0 == p && $0.1 == top.1 }) { return (p, true) }
            return nil
        }
        return (top.0, false)
    }
}

// MARK: - Reader (classifier + parser per platform)

enum ScreenReaderRules {
    struct Result {
        let platform: Platform?
        let event: ScreenEvent?       // nil == UNKNOWN, discard
        let usedColour: Bool
    }

    static func read(_ lines: [OCRLine], accent: Accent?, at date: Date = Date()) -> Result {
        let s = ScreenText(lines)
        guard let (platform, usedColour) = PlatformDetector.detect(s, accent: accent) else {
            return Result(platform: nil, event: nil, usedColour: false)
        }
        var event: ScreenEvent?
        switch platform {
        case .uber: event = UberRules.read(s)
        case .justEat: event = JustEatRules.read(s)
        case .deliveroo: event = DeliverooRules.read(s)
        }
        event?.at = date
        if var e = event { sanitize(&e); event = e }
        return Result(platform: platform, event: event, usedColour: usedColour)
    }

    // Last line of privacy defence, whatever a platform's rules picked up: the restaurant field never
    // holds a street address (keep its postcode as the pickup postcode instead), package pickups never
    // get a name, and postcodes are re-normalised so no street text can ride along.
    static func sanitize(_ e: inout ScreenEvent) {
        if let r = e.restaurant, Parse.isAddressLike(r) || e.offerType == OfferType.package {
            if e.pickupPostcode == nil { e.pickupPostcode = Parse.postcode(r) }
            e.restaurant = nil
            if e.offerType == OfferType.delivery { e.offerType = OfferType.package }
        }
        e.pickupPostcode = e.pickupPostcode.flatMap(Parse.postcode)
        e.dropPostcode = e.dropPostcode.flatMap(Parse.postcode)
    }
}

enum UberRules {
    static let trip = #"(\+\s*)?(\d{1,3})\s*min\s*\((\+\s*)?(\d{1,3}(?:[.,]\d)?)\s*mi\)"#

    static func classify(_ s: ScreenText) -> EventType {
        if s.hasLine("delivered") && s.has("leave at door") { return .delivered }
        if Parse.cancelled(s) { return .cancelled }
        if s.firstIndex(matching: trip) != nil && Parse.headlinePay(s) != nil {
            // After Confirm the card stays up, greyed, with a spinner where the button was.
            return s.hasLine("confirm") ? .newOffer : .orderAccepted
        }
        if s.has("complete pick-up") || s.firstIndex(matching: #"^pick up \d+ orders?"#) != nil { return .arrived }
        if s.has("trip guide"), s.firstIndex(matching: #"^pick-up\b"#) == nil, s.firstIndex(matching: #"^drop-off\b"#) != nil {
            return .pickedUp     // trip guide only lists the drop-off: food is in the bag
        }
        return .unknown
    }

    static func read(_ s: ScreenText) -> ScreenEvent? {
        let type = classify(s)
        guard type != .unknown else { return nil }
        var e = ScreenEvent(platform: .uber, type: type)
        switch type {
        case .newOffer, .orderAccepted:
            var addOn = false
            if let (pay, plus) = Parse.headlinePay(s) { e.pay = pay; addOn = plus }
            // Card tag: "Delivery" (food) or "Package". OCR prefixes the tag icon with junk ("Y9 Delivery").
            let package = s.firstIndex(matching: #"\bpackages?\b"#) != nil
            if let i = s.firstIndex(matching: trip), let m = Rx.match(trip, s.lines[i].text) {
                e.minutes = Int(m[2]); e.miles = Parse.number(m[4])
                if !m[1].isEmpty { addOn = true }
                // Next two lines: pickup (restaurant name, or an address for packages), then the drop-off.
                if let r = s.nextTextLine(after: i, minX: 0.08) {
                    let pickup = s.lines[r].text
                    if package || Parse.isAddressLike(pickup) { e.pickupPostcode = Parse.postcode(pickup) }
                    else { e.restaurant = Parse.cleanName(pickup) }
                    if let a = s.nextTextLine(after: r, minX: 0.08) { e.dropPostcode = Parse.postcode(s.lines[a].text) }
                }
            }
            e.offerType = addOn ? OfferType.addOn : (package || (e.restaurant == nil && e.pickupPostcode != nil)) ? OfferType.package : OfferType.delivery
            e.flags += Parse.flags(s)
        case .arrived:
            if let p = s.lines.firstIndex(where: { Parse.postcode($0.text) != nil }), p > 0, s.lines[p - 1].text.count >= 3 {
                e.restaurant = Parse.cleanName(s.lines[p - 1].text)
            }
        case .cancelled:
            e.cancellationFee = Parse.cancellationFee(s)
        default: break
        }
        return e
    }
}

enum JustEatRules {
    static func classify(_ s: ScreenText) -> EventType {
        if s.has("are you sure?") && s.has("decline offer") { return .offerDeclined }
        if s.has("offer declined") { return .offerDeclined }
        if s.has("accept offer") { return .newOffer }
        if s.has("delivery code is valid") { return .delivered }
        if Parse.cancelled(s) { return .cancelled }
        if s.has("picked up order") { return .arrived }
        if s.has("starting route") { return .pickedUp }
        if s.has("i've arrived") && s.has("navigate to business") { return .orderAccepted }
        return .unknown
    }

    static func read(_ s: ScreenText) -> ScreenEvent? {
        let type = classify(s)
        guard type != .unknown else { return nil }
        var e = ScreenEvent(platform: .justEat, type: type)
        switch type {
        case .newOffer:
            e.offerType = OfferType.delivery
            e.pay = Parse.headlinePay(s)?.0
            if let i = s.firstIndex(matching: #"\d\s*m[il1]\s*[-·•.]?\s*\d+\s*stops?"#),
               let m = Rx.match(#"(\d{1,3}(?:[.,]\d)?)\s*m[il1]\s*[-·•.]?\s*(\d+)\s*stops?"#, s.lines[i].text) {
                e.miles = Parse.number(m[1]); e.stops = Int(m[2])
            }
            if let p = s.firstIndex(matching: #"^\d+\s*pickups?:"#) {
                let first = s.lines[p].text.components(separatedBy: ":").dropFirst().joined(separator: ":")
                e.restaurant = name(s, from: p, firstText: first)
                e.pickupPostcode = postcode(s, after: p)
            }
            if let d = s.firstIndex(matching: #"^\d+\s*deliver(y|ies):"#) { e.dropPostcode = postcode(s, after: d) }
            let etas = s.lines.compactMap { Rx.match(#"arrive at\s*(\d{1,2}:\d{2}\s*[ap]m)"#, $0.text)?[1] }
            e.pickupETA = etas.first.map(Parse.eta)
            e.dropETA = etas.dropFirst().first.map(Parse.eta)
            if let c = s.lines.first(where: { $0.box.minX > 0.6 && Rx.match(#"^\d{1,2}:\d{2}$"#, $0.text) != nil }) {
                let parts = c.text.split(separator: ":").compactMap { Int($0) }
                if parts.count == 2 { e.countdownSec = parts[0] * 60 + parts[1] }
            }
            e.flags = Parse.flags(s)
        case .orderAccepted, .arrived:
            if let a = s.firstIndex(matching: #"^(arrive|pick up) at"#), let n = s.nextTextLine(after: a) {
                e.restaurant = name(s, from: n, firstText: s.lines[n].text)
            }
        case .offerDeclined:
            if s.has("are you sure?") { e.pending = true; e.pay = Parse.headlinePay(s)?.0 }
            // Today's earnings pill sits at the top of the idle map.
            if let top = s.lines.first(where: { $0.box.minY < 0.2 && Rx.match(#"[£€]\s*\d+[.,]\d{2}"#, $0.text) != nil }),
               let m = Rx.match(#"[£€]\s*([0-9]{1,4}[.,][0-9]{2})"#, top.text) {
                e.earningsToday = Parse.number(m[1])
            }
        case .cancelled:
            e.cancellationFee = Parse.cancellationFee(s)
        default: break
        }
        return e
    }

    // Just Eat wraps "Brand • Branch (Brand - Branch…" over several lines, then the address.
    // A comma or "(" ends the name; a continuation line with a comma / number / postcode is the address.
    static func name(_ s: ScreenText, from i: Int, firstText: String) -> String? {
        func cut(_ t: String) -> (String, Bool) {
            if let r = t.rangeOfCharacter(from: CharacterSet(charactersIn: ",(")) { return (String(t[..<r.lowerBound]), true) }
            return (t, false)
        }
        var (name, done) = cut(firstText)
        var j = i + 1
        while !done, j < s.lines.count, j <= i + 3 {
            let t = s.lines[j].text
            if t.contains("(") { name += " " + cut(t).0; break }
            if t.contains(",") || Parse.postcode(t) != nil || t.first?.isNumber == true || t.lowercased().hasPrefix("unit") { break }
            if s.lower[j].hasPrefix("arrive at") { break }
            name += " " + t
            j += 1
            done = false
        }
        let cleaned = Parse.cleanName(name)
        return cleaned.isEmpty ? nil : cleaned
    }

    static func postcode(_ s: ScreenText, after i: Int) -> String? {
        var j = i
        while j < s.lines.count, j <= i + 4 {
            if j > i, s.lower[j].hasPrefix("arrive at") { break }
            if let p = Parse.postcode(s.lines[j].text) { return p }
            j += 1
        }
        return nil
    }
}

enum DeliverooRules {
    static func classify(_ s: ScreenText) -> EventType {
        if s.has("accept and go") { return .newOffer }
        if Parse.cancelled(s) { return .cancelled }
        if s.has("check in now") || s.has("find the tag") { return .arrived }
        if s.has("go to customer") && s.has("collect order") { return .pickedUp }
        if s.has("go to restaurant") { return .orderAccepted }
        if s.hasLine("confirm delivery") { return .delivered }
        return .unknown
    }

    static func read(_ s: ScreenText) -> ScreenEvent? {
        let type = classify(s)
        guard type != .unknown else { return nil }
        var e = ScreenEvent(platform: .deliveroo, type: type)
        switch type {
        case .newOffer:
            e.offerType = OfferType.delivery
            // Pay sits on the same row as "1 order"; the rider-stats row above also shows a £ amount.
            let orderRow = s.firstIndex(matching: #"\d\s*orders?\b"#)
            e.pay = Parse.headlinePay(s, near: orderRow)?.0 ?? Parse.headlinePay(s)?.0
            if let r = orderRow, let m = Rx.match(#"(\d+)\s*orders?\b"#, s.lines[r].text) { e.orders = Int(m[1]) }
            let payRow = s.lines.firstIndex { Rx.match(#"[£€]\s*\d"#, $0.text) != nil && e.pay != nil && $0.text.contains(String(format: "%.2f", e.pay!)) }
            let anchor = max(orderRow ?? -1, payRow ?? -1)
            if anchor >= 0, let n = s.nextTextLine(after: anchor) {
                e.restaurant = Parse.cleanName(s.lines[n].text)
                let codes = s.lines[(n + 1)...].compactMap { Parse.postcode($0.text) }
                e.pickupPostcode = codes.first
                e.dropPostcode = codes.dropFirst().first
            }
            // minutes / miles stay nil: Deliveroo doesn't show them, the engine routes it itself.
            e.flags = Parse.flags(s)
        case .orderAccepted, .arrived, .pickedUp:
            let anchor = s.firstIndex(containing: "go to restaurant") ?? s.firstIndex(containing: "collect order")
            if let a = anchor, let n = s.nextTextLine(after: a) { e.restaurant = Parse.cleanName(s.lines[n].text) }
        case .cancelled:
            e.cancellationFee = Parse.cancellationFee(s)
        default: break
        }
        return e
    }
}
