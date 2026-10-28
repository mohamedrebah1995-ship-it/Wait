import Foundation
import Vision
import CoreGraphics
import CoreVideo

// On-device text recognition. Shared by the extension (iOS) and the Mac test harness, so it must not
// import UIKit/AppKit. Nothing recognised here is stored; callers keep only the parsed fields.

struct OCRLine {
    let text: String
    let box: CGRect          // normalised 0…1, origin TOP-left (Vision's is bottom-left; flipped here)
    let confidence: Float
}

enum OCR {
    // Frames narrower than this are upscaled before OCR. Compressed recordings come in at 296px wide,
    // where Vision misses small text; real device frames are 1100px+ and are never upscaled.
    static let minWidthForOCR = 900

    static func recognize(_ image: CGImage) -> [OCRLine] {
        if image.width < minWidthForOCR, let big = upscale(image, to: minWidthForOCR) {
            return run(VNImageRequestHandler(cgImage: big, options: [:]))
        }
        return run(VNImageRequestHandler(cgImage: image, options: [:]))
    }

    static func recognize(_ pixelBuffer: CVPixelBuffer) -> [OCRLine] {
        run(VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:]))
    }

    private static func run(_ handler: VNImageRequestHandler) -> [OCRLine] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-GB"]
        request.usesLanguageCorrection = false     // correction "fixes" prices and postcodes into words
        do { try handler.perform([request]) } catch { return [] }
        let results = request.results ?? []
        return results.compactMap { obs in
            guard let top = obs.topCandidates(1).first else { return nil }
            let b = obs.boundingBox
            return OCRLine(text: top.string,
                           box: CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height),
                           confidence: top.confidence)
        }
        .sorted { abs($0.box.minY - $1.box.minY) > 0.008 ? $0.box.minY < $1.box.minY : $0.box.minX < $1.box.minX }
    }

    // Plain CoreGraphics (no Core Image, whose GPU context is heavier than the extension's memory limit).
    private static func upscale(_ image: CGImage, to width: Int) -> CGImage? {
        let height = Int(Double(image.height) * Double(width) / Double(image.width))
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return ctx.makeImage()
    }
}
