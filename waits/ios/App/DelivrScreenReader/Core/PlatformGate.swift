import Foundation
import CoreGraphics
import CoreVideo

// Stage 1 of 2, before any OCR: a cheap pixel check on the bottom 45% of the frame. Frames that fail
// are discarded unread.
//
// Two tiers:
//   .button(app)  always allowed. A wide saturated button in Uber green, Just Eat orange or Deliveroo
//                 teal, or Uber's green offer-card border. Offers and most status screens.
//   .layout       allowed ONLY in delivery context (a run is active, or a delivery app was recognised in
//                 the last few minutes). Status screens with no coloured button: a wide neutral action
//                 bar near the bottom with side margins (greyed "Complete pick-up" / "Delivered" /
//                 "Go to customer", white "Decline offer", the "Offer Declined" toast, Just Eat's green
//                 "code is valid" strip), or Uber's red STOP NEW REQUESTS disc.
//
// Colour windows measured on the fixtures: Uber Confirm h≈145, Just Eat h≈20–22, Deliveroo h≈174–185.
enum GateResult: Equatable {
    case button(Accent)
    case layout

    var accent: Accent? { if case .button(let a) = self { return a }; return nil }
}

enum PlatformGate {
    static let bandTop = 0.55
    static let cols = 96
    static let minRunFraction = 0.6        // coloured button spans ≥ 60% of the width…
    static let buttonHeightFraction = 0.02 // …and is ≥ 2% of the screen tall (a button, not a line)
    static let minRows = 3
    static let outlineRunFraction = 0.85   // Uber card border: one straight line across ≥ 85%
    // Neutral action bar (layout tier)
    static let barTop = 0.80               // only the bottom 20% of the screen
    static let barMinWidth = 0.75, barMaxWidth = 0.985   // margins on both sides: not a full-width background
    static let barMinHeight = 0.02, barMaxHeight = 0.10
    static let barContrast = 0.04          // luminance step between the bar and what's above it

    // ReplayKit frame: 420 YpCbCr bi-planar (usual) or BGRA.
    static func check(_ pb: CVPixelBuffer, allowLayout: Bool) -> GateResult? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        let format = CVPixelBufferGetPixelFormatType(pb)
        if CVPixelBufferIsPlanar(pb), CVPixelBufferGetPlaneCount(pb) >= 2,
           let yBase = CVPixelBufferGetBaseAddressOfPlane(pb, 0), let cBase = CVPixelBufferGetBaseAddressOfPlane(pb, 1) {
            let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
            let yRow = CVPixelBufferGetBytesPerRowOfPlane(pb, 0), cRow = CVPixelBufferGetBytesPerRowOfPlane(pb, 1)
            let Y = yBase.assumingMemoryBound(to: UInt8.self), C = cBase.assumingMemoryBound(to: UInt8.self)
            let video = format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            return scan(width: w, height: h, allowLayout: allowLayout) { x, y in
                var l = Double(Y[y * yRow + x]) / 255
                var cb = Double(C[(y / 2) * cRow + (x / 2) * 2]) / 255 - 0.5
                var cr = Double(C[(y / 2) * cRow + (x / 2) * 2 + 1]) / 255 - 0.5
                if video { l = (l - 16.0 / 255) * 255 / 219; cb *= 255.0 / 224; cr *= 255.0 / 224 }
                return (l + 1.5748 * cr, l - 0.1873 * cb - 0.4681 * cr, l + 1.8556 * cb)   // BT.709
            }
        }
        guard format == kCVPixelFormatType_32BGRA, let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), row = CVPixelBufferGetBytesPerRow(pb)
        let P = base.assumingMemoryBound(to: UInt8.self)
        return scan(width: w, height: h, allowLayout: allowLayout) { x, y in
            let o = y * row + x * 4
            return (Double(P[o + 2]) / 255, Double(P[o + 1]) / 255, Double(P[o]) / 255)
        }
    }

    // Still image (Mac harness).
    static func check(_ image: CGImage, allowLayout: Bool) -> GateResult? {
        let w = image.width, h = image.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = ctx.data else { return nil }
        let P = data.assumingMemoryBound(to: UInt8.self)
        return scan(width: w, height: h, allowLayout: allowLayout) { x, y in
            let o = (y * w + x) * 4
            return (Double(P[o]) / 255, Double(P[o + 1]) / 255, Double(P[o + 2]) / 255)
        }
    }

    // Every row of the band, 96 columns: ~120k reads per frame.
    private static func scan(width w: Int, height h: Int, allowLayout: Bool,
                             _ rgb: (Int, Int) -> (Double, Double, Double)) -> GateResult? {
        let top = Int(Double(h) * bandTop)
        let needButton = Int(Double(cols) * minRunFraction), needOutline = Int(Double(cols) * outlineRunFraction)
        let minButtonRows = max(minRows, Int(Double(h) * buttonHeightFraction))
        var buttonRows: [Accent: Int] = [:], outlineRows: [Accent: Int] = [:]
        let barStart = Int(Double(h) * barTop)
        var bars: [(y: Int, lum: Double)?] = []          // per row from barStart: a margin-to-margin flat run, if any
        var rowLum: [Double] = []                        // per row from barStart: luminance at the centre column
        var red = (n: 0, minX: cols, maxX: -1, minY: h, maxY: -1)

        for y in top..<h {
            var cur: Accent?, len = 0
            var best: [Accent: Int] = [:]
            // Per luminance bin (0.04 wide): how many flat pixels, and the first/last column they reach.
            var binN = [Int](repeating: 0, count: 26), binFirst = [Int](repeating: cols, count: 26), binLast = [Int](repeating: -1, count: 26)
            for c in 0..<cols {
                let px = rgb((c * w) / cols, y)
                let fam = family(px)
                if let p = fam, p == cur { len += 1 } else { cur = fam; len = fam == nil ? 0 : 1 }
                if let p = fam { best[p] = max(best[p] ?? 0, len) }
                guard allowLayout, y >= barStart else { continue }
                let (lum, sat, hue) = hsl(px)
                // Flat pixel: neutral (or Just Eat's dark-green strip). Text on a button only dents the
                // count, so a labelled button still reads as one bar.
                if sat < 0.25 || (hue >= 100 && hue < 170 && lum < 0.35) {
                    let bin = min(25, Int(lum / 0.04))
                    binN[bin] += 1; binFirst[bin] = min(binFirst[bin], c); binLast[bin] = max(binLast[bin], c)
                }
                if c == cols / 2 { rowLum.append(lum) }
                // Red disc (Uber STOP NEW REQUESTS)
                if sat > 0.6 && (hue < 10 || hue >= 350) && lum > 0.25 {
                    red.n += 1; red.minX = min(red.minX, c); red.maxX = max(red.maxX, c); red.minY = min(red.minY, y); red.maxY = max(red.maxY, y)
                }
            }
            for (p, n) in best {
                if n >= needButton { buttonRows[p, default: 0] += 1 }
                if n >= needOutline { outlineRows[p, default: 0] += 1 }
            }
            if allowLayout && y >= barStart {
                // The row's dominant flat shade must reach margin to margin and fill ≥ 60% of that span.
                var row: (y: Int, lum: Double)?
                if let b = binN.indices.max(by: { binN[$0] < binN[$1] }), binN[b] > 0 {
                    let extent = binLast[b] - binFirst[b] + 1
                    let frac = Double(extent) / Double(cols)
                    if frac >= barMinWidth && frac <= barMaxWidth && Double(binN[b]) >= 0.6 * Double(extent) {
                        row = (y, (Double(b) + 0.5) * 0.04)
                    }
                }
                bars.append(row)
            }
        }
        if let b = buttonRows.filter({ $0.value >= minButtonRows }).max(by: { $0.value < $1.value }) { return .button(b.key) }
        // Uber draws its offer card with a thin green border, which stays after Confirm greys the button.
        if (outlineRows[.green] ?? 0) >= 1 { return .button(.green) }
        guard allowLayout else { return nil }

        // Neutral action bar: consecutive bar rows of one shade, button-tall, standing out from the row above.
        var i = 0
        while i < bars.count {
            guard let first = bars[i] else { i += 1; continue }
            var j = i
            while j + 1 < bars.count, let nxt = bars[j + 1], abs(nxt.lum - first.lum) < 0.05 { j += 1 }
            let height = Double(j - i + 1) / Double(h)
            let above = i >= 2 ? rowLum[i - 2] : nil
            if height >= barMinHeight && height <= barMaxHeight, let a = above, abs(a - first.lum) > barContrast { return .layout }
            i = j + 1
        }
        // Red STOP disc: a filled red blob, 8–30% of the width, roughly centred and roughly round.
        if red.maxX >= 0 {
            let bw = Double(red.maxX - red.minX + 1) / Double(cols)
            let bh = Double(red.maxY - red.minY + 1) / Double(w)    // height as a fraction of the screen WIDTH
            let cx = Double(red.minX + red.maxX) / 2 / Double(cols)
            if bw >= 0.08 && bw <= 0.30 && cx > 0.35 && cx < 0.65 && bh > bw * 0.6 && bh < bw * 1.6 { return .layout }
        }
        return nil
    }

    private static func hsl(_ px: (Double, Double, Double)) -> (lum: Double, sat: Double, hue: Double) {
        let r = min(max(px.0, 0), 1), g = min(max(px.1, 0), 1), b = min(max(px.2, 0), 1)
        let mx = max(r, g, b), mn = min(r, g, b)
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        guard mx > 0, mx != mn else { return (lum, 0, 0) }
        var hue: Double
        if mx == r { hue = 60 * ((g - b) / (mx - mn)) } else if mx == g { hue = 60 * ((b - r) / (mx - mn) + 2) } else { hue = 60 * ((r - g) / (mx - mn) + 4) }
        if hue < 0 { hue += 360 }
        return (lum, (mx - mn) / mx, hue)
    }

    private static func family(_ px: (Double, Double, Double)) -> Accent? {
        let r = min(max(px.0, 0), 1), g = min(max(px.1, 0), 1), b = min(max(px.2, 0), 1)
        let mx = max(r, g, b)
        guard mx > 0.3 else { return nil }
        let (_, s, hue) = hsl(px)
        if s == 0 { return nil }
        if hue >= 138 && hue < 158 && s >= 0.45 { return .green }    // Uber
        if hue >= 12 && hue < 30 && s >= 0.8 { return .orange }      // Just Eat
        if hue >= 166 && hue < 192 && s >= 0.6 { return .teal }      // Deliveroo
        return nil
    }
}
