import Foundation
import CoreGraphics
import CoreVideo

// Decides whether a frame is worth OCR. Watches only the bottom 45% of the screen, where every app's
// offer and status cards sit; the navigation map above moves constantly and would make every frame
// look new. The band is averaged into 32×24 cells and a frame counts as changed only when enough
// cells moved, so a pulsing location dot or a spinner doesn't wake OCR either.
struct ChangeDetector {
    static let bandTop = 0.55             // band = bottom 45%
    static let cols = 32, rows = 24
    static let cellDelta = 10.0           // mean-luma change (0–255) for a cell to count
    static let minChangedCells = 8        // ~1% of the band

    private var last: [Double]?

    // True when the band differs from the previous call's band (always true for the first frame).
    mutating func changed(_ cells: [Double]) -> Bool {
        defer { last = cells }
        guard let prev = last, prev.count == cells.count else { return true }
        var n = 0
        for i in cells.indices where abs(cells[i] - prev[i]) > Self.cellDelta { n += 1 }
        return n >= Self.minChangedCells
    }

    // ReplayKit frame → cell means. Luma plane for 420 YpCbCr, green channel for BGRA.
    static func cells(_ pb: CVPixelBuffer) -> [Double]? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        let planar = CVPixelBufferIsPlanar(pb)
        guard let base = planar ? CVPixelBufferGetBaseAddressOfPlane(pb, 0) : CVPixelBufferGetBaseAddress(pb) else { return nil }
        let w = planar ? CVPixelBufferGetWidthOfPlane(pb, 0) : CVPixelBufferGetWidth(pb)
        let h = planar ? CVPixelBufferGetHeightOfPlane(pb, 0) : CVPixelBufferGetHeight(pb)
        let row = planar ? CVPixelBufferGetBytesPerRowOfPlane(pb, 0) : CVPixelBufferGetBytesPerRow(pb)
        let step = planar ? 1 : 4, offset = planar ? 0 : 1
        if !planar && CVPixelBufferGetPixelFormatType(pb) != kCVPixelFormatType_32BGRA { return nil }
        let P = base.assumingMemoryBound(to: UInt8.self)
        return grid(width: w, height: h) { x, y in Double(P[y * row + x * step + offset]) }
    }

    // Still image (Mac harness) → the same cell means.
    static func cells(_ image: CGImage) -> [Double]? {
        let w = image.width, h = image.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = ctx.data else { return nil }
        let P = data.assumingMemoryBound(to: UInt8.self)
        return grid(width: w, height: h) { x, y in Double(P[y * w + x]) }
    }

    // 4×4 samples per cell over the band, averaged. ~12k reads per frame.
    private static func grid(width w: Int, height h: Int, _ px: (Int, Int) -> Double) -> [Double] {
        let top = Int(Double(h) * bandTop), bandH = h - top
        var out = [Double](repeating: 0, count: cols * rows)
        for r in 0..<rows {
            for c in 0..<cols {
                var sum = 0.0
                for sy in 0..<4 {
                    let y = top + ((r * 4 + sy) * bandH) / (rows * 4)
                    for sx in 0..<4 { sum += px(((c * 4 + sx) * w) / (cols * 4), y) }
                }
                out[r * cols + c] = sum / 16
            }
        }
        return out
    }
}
