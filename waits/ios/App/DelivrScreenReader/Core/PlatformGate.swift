import Foundation
import CoreGraphics
import CoreVideo

// Stage 1 of 2, before any OCR: a cheap pixel check on the bottom 45% of the frame for a delivery
// app's main button: a wide, saturated bar in Uber green, Just Eat orange or Deliveroo teal. Frames
// without one are discarded unread. Thin coloured lines (map roads, route lines) fail the shape test.
//
// Colour windows measured on the fixtures: Uber Confirm h≈145 (greyed after accept: s 0.55, v 0.35),
// Just Eat h≈20–22, Deliveroo h≈174–185.
enum PlatformGate {
    static let bandTop = 0.55
    static let cols = 96
    static let minRunFraction = 0.6       // the bar spans ≥ 60% of the screen width…
    static let buttonHeightFraction = 0.02 // …and is ≥ 2% of the screen tall (a button, not a line)
    static let minRows = 3
    static let outlineRunFraction = 0.85  // Uber card border: one straight line across ≥ 85%

    // ReplayKit frame: 420 YpCbCr bi-planar (usual) or BGRA.
    static func signature(_ pb: CVPixelBuffer) -> Accent? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        let format = CVPixelBufferGetPixelFormatType(pb)
        if CVPixelBufferIsPlanar(pb), CVPixelBufferGetPlaneCount(pb) >= 2,
           let yBase = CVPixelBufferGetBaseAddressOfPlane(pb, 0), let cBase = CVPixelBufferGetBaseAddressOfPlane(pb, 1) {
            let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
            let yRow = CVPixelBufferGetBytesPerRowOfPlane(pb, 0), cRow = CVPixelBufferGetBytesPerRowOfPlane(pb, 1)
            let Y = yBase.assumingMemoryBound(to: UInt8.self), C = cBase.assumingMemoryBound(to: UInt8.self)
            let video = format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            return scan(width: w, height: h) { x, y in
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
        return scan(width: w, height: h) { x, y in
            let o = y * row + x * 4
            return (Double(P[o + 2]) / 255, Double(P[o + 1]) / 255, Double(P[o]) / 255)
        }
    }

    // Still image (Mac harness).
    static func signature(_ image: CGImage) -> Accent? {
        let w = image.width, h = image.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = ctx.data else { return nil }
        let P = data.assumingMemoryBound(to: UInt8.self)
        return scan(width: w, height: h) { x, y in
            let o = (y * w + x) * 4
            return (Double(P[o]) / 255, Double(P[o + 1]) / 255, Double(P[o + 2]) / 255)
        }
    }

    // Every row of the band (a card border is only a few pixels tall), 96 columns: ~120k reads per frame.
    // Per colour: rows whose longest same-colour run is button-wide, and rows that are outline-wide.
    private static func scan(width w: Int, height h: Int, _ rgb: (Int, Int) -> (Double, Double, Double)) -> Accent? {
        let top = Int(Double(h) * bandTop)
        let needButton = Int(Double(cols) * minRunFraction), needOutline = Int(Double(cols) * outlineRunFraction)
        let minButtonRows = max(minRows, Int(Double(h) * buttonHeightFraction))
        var buttonRows: [Accent: Int] = [:], outlineRows: [Accent: Int] = [:]
        for y in top..<h {
            var cur: Accent?, len = 0
            var best: [Accent: Int] = [:]
            for c in 0..<cols {
                let px = family(rgb((c * w) / cols, y))
                if let p = px, p == cur { len += 1 } else { cur = px; len = px == nil ? 0 : 1 }
                if let p = px { best[p] = max(best[p] ?? 0, len) }
            }
            for (p, n) in best {
                if n >= needButton { buttonRows[p, default: 0] += 1 }
                if n >= needOutline { outlineRows[p, default: 0] += 1 }
            }
        }
        if let b = buttonRows.filter({ $0.value >= minButtonRows }).max(by: { $0.value < $1.value }) { return b.key }
        // Card layout: Uber draws its offer card with a thin green border, which stays after Confirm
        // greys the button out. A straight green line across ≥ 85% of the width, not a map road.
        if (outlineRows[.green] ?? 0) >= 1 { return .green }
        return nil
    }

    private static func family(_ px: (Double, Double, Double)) -> Accent? {
        let r = min(max(px.0, 0), 1), g = min(max(px.1, 0), 1), b = min(max(px.2, 0), 1)
        let mx = max(r, g, b), mn = min(r, g, b)
        guard mx > 0.3 else { return nil }
        let s = (mx - mn) / mx
        var hue: Double
        if mx == mn { return nil }
        if mx == r { hue = 60 * ((g - b) / (mx - mn)) } else if mx == g { hue = 60 * ((b - r) / (mx - mn) + 2) } else { hue = 60 * ((r - g) / (mx - mn) + 4) }
        if hue < 0 { hue += 360 }
        if hue >= 138 && hue < 158 && s >= 0.45 { return .green }    // Uber
        if hue >= 12 && hue < 30 && s >= 0.8 { return .orange }      // Just Eat
        if hue >= 166 && hue < 192 && s >= 0.6 { return .teal }      // Deliveroo
        return nil
    }
}
