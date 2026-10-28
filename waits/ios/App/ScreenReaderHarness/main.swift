import Foundation
import ImageIO

// Offline test harness: runs the SAME OCR + classifier + parser the extension uses over every fixture PNG.
// Usage: ios/App/ScreenReaderHarness/run.sh [fixtures dir]   (default: <repo>/fixtures)

let root = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "fixtures"
let platforms = ["uber", "justeat", "deliveroo"]

func pad(_ s: String, _ n: Int) -> String { s.count >= n ? String(s.prefix(n)) : s + String(repeating: " ", count: n - s.count) }

func fields(_ e: ScreenEvent?) -> String {
    guard let e = e else { return "—" }
    var f: [String] = []
    if let v = e.offerType { f.append(v) }
    if let v = e.pay { f.append((e.offerType == OfferType.addOn ? "+" : "") + String(format: "£%.2f", v)) }
    if let v = e.minutes { f.append("\(v) min") }
    if let v = e.miles { f.append(String(format: "%.1f mi", v)) }
    if let v = e.stops { f.append("\(v) stops") }
    if let v = e.orders { f.append("\(v) order") }
    if let v = e.restaurant { f.append("\"\(v)\"") }
    if let v = e.pickupPostcode { f.append("pick \(v)") }
    if let v = e.dropPostcode { f.append("drop \(v)") }
    if let v = e.countdownSec { f.append("⏱\(v)s") }
    if let v = e.pickupETA { f.append("pickETA \(v)") }
    if let v = e.dropETA { f.append("dropETA \(v)") }
    if e.pending == true { f.append("pending") }
    if let v = e.earningsToday { f.append(String(format: "today £%.2f", v)) }
    if !e.flags.isEmpty { f.append("[" + e.flags.joined(separator: ", ") + "]") }
    return f.joined(separator: " · ")
}

let baseline = MemoryProbe.footprintMB()
var peak = baseline
var rows = 0, passes = 0, passesNoGate = 0, colourUsed = 0
var perPlatform: [String: (Int, Int)] = [:]
var offers: [String: (Int, Int)] = [:]
var failures: [String] = []
var readByName: [String: ScreenEvent] = [:]
var gatedOut: [String] = []
var wrongGate: [String] = []
let gateName: [Accent: String] = [.green: "Uber", .orange: "JustEat", .teal: "Roo"]
let wantAccent: [String: Accent] = ["uber": .green, "justeat": .orange, "deliveroo": .teal]

print(pad("platform", 10) + "| " + pad("file", 42) + "| " + pad("gate", 8) + "| " + pad("expected", 15) + "| " + pad("detected", 15) + "| " + pad("fields", 92) + "| result")
print(String(repeating: "-", count: 10 + 42 + 8 + 15 + 15 + 92 + 20))

for p in platforms {
    let dir = "\(root)/\(p)"
    let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []).filter { $0.hasSuffix(".png") }.sorted()
    for f in files {
        let name = "\(p)/\(f.replacingOccurrences(of: ".png", with: ""))"
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: "\(dir)/\(f)") as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { continue }
        // Same order as the extension: gate first, OCR only behind it. The ungated read is kept only to
        // report what the gate costs.
        // Fixtures are frames from real shifts, so they're judged in delivery context (layout tier on).
        let gateResult = PlatformGate.check(img, allowLayout: true)
        let gate: String? = gateResult.map { $0.accent.map { gateName[$0]! } ?? "layout" }
        let (ungated, platform, used): (ScreenEvent?, Platform?, Bool) = autoreleasepool {
            let r = ScreenReaderRules.read(OCR.recognize(img), accent: gateResult?.accent)
            return (r.event, r.platform, r.usedColour)
        }
        let event = gate == nil ? nil : ungated
        peak = max(peak, MemoryProbe.footprintMB())
        if used { colourUsed += 1 }
        if let e = ungated { readByName[name] = e }
        if let a = gateResult?.accent, a != wantAccent[p] { wrongGate.append("\(name): \(gateName[a]!)") }

        guard let x = expectations[name] else {
            print(pad(p, 10) + "| " + pad(f, 42) + "| " + pad(gate ?? "—", 8) + "| " + pad("(no README row)", 15) + "| " + pad(event?.type.rawValue ?? "UNKNOWN", 15) + "| " + pad(fields(event), 92) + "| ?")
            continue
        }
        let wrongPlatform: (ScreenEvent?) -> Bool = { e in e != nil && platform?.rawValue != ["uber": "UBER_EATS", "justeat": "JUST_EAT", "deliveroo": "DELIVEROO"][p] }
        let bad = check(event, x)
        let ok = bad.isEmpty && !wrongPlatform(event)
        if check(ungated, x).isEmpty && !wrongPlatform(ungated) { passesNoGate += 1 }
        let lostToGate = !ok && gate == nil && ungated?.type == x.type
        if lostToGate { gatedOut.append("\(name) (\(x.type.rawValue))") }
        rows += 1; if ok { passes += 1 }
        var pp = perPlatform[p] ?? (0, 0); pp.0 += 1; if ok { pp.1 += 1 }; perPlatform[p] = pp
        if x.type == .newOffer { var o = offers[p] ?? (0, 0); o.0 += 1; if ok { o.1 += 1 }; offers[p] = o }
        if !ok && !lostToGate { failures.append("\(name): " + (wrongPlatform(event) ? ["platform \(platform?.rawValue ?? "nil")"] : bad).joined(separator: "; ")) }
        print(pad(p, 10) + "| " + pad(f.replacingOccurrences(of: ".png", with: ""), 42) + "| " + pad(gate ?? "—", 8) + "| "
              + pad(x.type.rawValue, 15) + "| " + pad(event?.type.rawValue ?? "UNKNOWN", 15) + "| " + pad(fields(event), 92) + "| "
              + (ok ? "PASS" : lostToGate ? "FAIL (gated out)" : "FAIL"))
    }
}

print("")
for p in platforms {
    let (n, ok) = perPlatform[p] ?? (0, 0)
    let (on, ook) = offers[p] ?? (0, 0)
    print("\(pad(p, 10)) all screens \(ok)/\(n)   offer screens \(ook)/\(on)")
}
print("TOTAL with gate \(passes)/\(rows)   (rules alone, no gate: \(passesNoGate)/\(rows))   colour tiebreak used on \(colourUsed) frame(s)")
if !gatedOut.isEmpty { print("\nEvents the gate discards before OCR (\(gatedOut.count)):"); gatedOut.forEach { print("  " + $0) } }
if !failures.isEmpty { print("\nOther failures:"); failures.forEach { print("  " + $0) } }
print("Gate picked the wrong app on \(wrongGate.count) frame(s)" + (wrongGate.isEmpty ? "" : ": " + wrongGate.joined(separator: "; ")))

// Negatives: screens from other apps (optional 2nd arg, a folder of PNGs). None may pass the gate AND
// produce an event; ideally none even pass the gate.
if CommandLine.arguments.count > 2 {
    let dir = CommandLine.arguments[2]
    let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []).filter { $0.hasSuffix(".png") }.sorted()
    var passed: [String] = [], logged: [String] = [], passedIdle = 0
    for f in files {
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: "\(dir)/\(f)") as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { continue }
        if PlatformGate.check(img, allowLayout: false) != nil { passedIdle += 1 }
        guard let g = PlatformGate.check(img, allowLayout: true) else { continue }
        passed.append("\(f) (\(g.accent.map { gateName[$0]! } ?? "layout"))")
        if ScreenReaderRules.read(OCR.recognize(img), accent: g.accent).event != nil { logged.append(f) }
    }
    print("\nOther-app frames: \(files.count) checked. Outside delivery context \(passedIdle) pass the gate (want 0). In delivery context \(passed.count) pass (OCR'd then discarded), \(logged.count) produced an event (want 0)"
          + (passed.isEmpty ? "" : "\n  passed gate: " + passed.joined(separator: ", ")))
}

// Debounce: an offer seen on 3 consecutive frames, then accepted, then the same offer re-shown = 2 events.
var deb = Debouncer()
var emitted: [String] = []
if let offer = readByName["uber/10_new_offer_842"], let accepted = readByName["uber/14_offer_accepting_loading_lowres"] {
    let t0 = Date()
    for (i, base) in [offer, offer, offer, accepted, offer].enumerated() {
        var e = base; e.at = t0.addingTimeInterval(Double(i))
        if deb.accept(e) { emitted.append(e.type.rawValue) }
    }
}
print("\nDebounce: 5 frames (offer ×3, accepted, offer again) → \(emitted.count) events: \(emitted.joined(separator: ", "))  \(emitted == ["NEW_OFFER", "ORDER_ACCEPTED"] ? "PASS" : "FAIL")")

// ── Change detector (battery). Simulates map movement by redrawing part of a screenshot shifted 40px,
// then asks whether that frame would wake OCR.
func load(_ name: String) -> CGImage? {
    guard let s = CGImageSourceCreateWithURL(URL(fileURLWithPath: "\(root)/\(name).png") as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(s, 0, nil)
}
// Copy of `img` with its top `fraction` replaced by the same content shifted (a panned map).
func panned(_ img: CGImage, topFraction fraction: Double) -> CGImage? {
    let w = img.width, h = img.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    let shift = CGFloat(w) * 40 / 1284                     // 40px on a full-res frame
    let topH = CGFloat(h) * CGFloat(fraction)
    ctx.clip(to: CGRect(x: 0, y: CGFloat(h) - topH, width: CGFloat(w), height: topH))   // CG origin bottom-left
    ctx.draw(img, in: CGRect(x: shift, y: -shift, width: CGFloat(w), height: CGFloat(h)))
    return ctx.makeImage()
}
func wakes(_ a: CGImage, _ b: CGImage) -> Bool {
    var d = ChangeDetector()
    guard let ca = ChangeDetector.cells(a), let cb = ChangeDetector.cells(b) else { return true }
    _ = d.changed(ca)
    return d.changed(cb)
}
var still = 0, mapAbove = 0, mapIntoBand = 0, total = 0
for p in platforms {
    for f in (((try? FileManager.default.contentsOfDirectory(atPath: "\(root)/\(p)")) ?? []).filter { $0.hasSuffix(".png") }.sorted()) {
        guard let img = load("\(p)/\(f.replacingOccurrences(of: ".png", with: ""))") else { continue }
        total += 1
        if wakes(img, img) { still += 1 }
        if let m = panned(img, topFraction: 0.55), wakes(img, m) { mapAbove += 1 }
        if let m = panned(img, topFraction: 0.80), wakes(img, m) { mapIntoBand += 1 }
    }
}
let cardChanges = [("uber/10_new_offer_842", "uber/11_new_offer_950"),
                   ("uber/12_new_offer_607_lowres", "uber/14_offer_accepting_loading_lowres"),
                   ("uber/32_at_customer_dropoff_lowres", "uber/33_leave_at_door_photo_lowres"),
                   ("justeat/22_at_restaurant_picked_up_button", "justeat/30_heading_to_customer_starting_route"),
                   ("justeat/40_new_offer_686", "justeat/41_decline_are_you_sure"),
                   ("deliveroo/20_go_to_restaurant", "deliveroo/21_at_restaurant_check_in"),
                   ("deliveroo/30_go_to_customer", "deliveroo/31_find_customer_arrived_button")]
var caught = 0
for (a, b) in cardChanges { if let ia = load(a), let ib = load(b), wakes(ia, ib) { caught += 1 } }
print("\nChange detector (bottom 45%):")
print("  identical frame wakes OCR:                     \(still)/\(total)   (want 0)")
print("  map panned above the band (offer/idle cards):  \(mapAbove)/\(total)   (want 0)")
print("  map panned down to 80% of screen (navigation): \(mapIntoBand)/\(total)   (map reaches into the band)")
print("  real card/button change wakes OCR:             \(caught)/\(cardChanges.count)   (want all)")

print(String(format: "\nMemory (Mac, this process): baseline %.1f MB, peak %.1f MB with OCR running", baseline, peak))
