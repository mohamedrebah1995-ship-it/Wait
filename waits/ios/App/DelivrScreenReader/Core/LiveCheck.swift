import Foundation

// Is this frame the live screen, or a picture of an old one (a screenshot open in Photos, in a chat)?
// A screenshot keeps its own status-bar clock; the live status bar always shows the time now. A clock
// near the top of the frame more than `tolerance` minutes off the real time means: not live. No clock
// read at all counts as live, so a missed OCR line never drops a real offer.
enum LiveCheck {
    static let tolerance = 2              // minutes
    static let topBand = 0.12             // a screenshot shown with the Photos bars sits a little lower

    static func showsOldClock(_ lines: [OCRLine], now: Date = Date()) -> Bool {
        let cal = Calendar.current
        let nowMin = (cal.component(.hour, from: now) % 12) * 60 + cal.component(.minute, from: now)
        // The status-bar clock sits top-left; OCR often tacks the location arrow / recording dot on ("14:231").
        for line in lines where line.box.minY < topBand && line.box.minX < 0.3 {
            guard let m = Rx.match(#"^\s*(\d{1,2})[:.](\d{2})\s?\S{0,2}\s*$"#, line.text),
                  let h = Int(m[1]), let mm = Int(m[2]), h < 24, mm < 60 else { continue }
            let diff = abs((h % 12) * 60 + mm - nowMin)
            if min(diff, 720 - diff) > tolerance { return true }   // 12h and 24h clocks both compare mod 12
        }
        return false
    }
}
