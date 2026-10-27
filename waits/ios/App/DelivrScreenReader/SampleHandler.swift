import ReplayKit
import CoreMedia
import CoreVideo

// Broadcast Upload Extension. iOS runs this in its own process with a ~50MB memory cap.
//
// Phase 1 behaviour: sample ~1 frame/sec, skip frames identical to the previous sample, and throw the
// frame away. Nothing is written to disk or sent anywhere. Phase 2 (Vision OCR) plugs in where marked.
class SampleHandler: RPBroadcastSampleHandler {

    private let sampleInterval: TimeInterval = 1.0
    private let grid = 64                       // 64×64 = 4096 sampled bytes per frame, cheap and fine enough to see text changes
    private var lastSampleAt: TimeInterval = 0
    private var lastHash: UInt64?
    private var ticks = 0
    private var changedFrames = 0

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        ticks = 0
        changedFrames = 0
        lastHash = nil
        lastSampleAt = 0
        ScreenReaderStore.set(ScreenReaderStore.Key.error, "")
        ScreenReaderStore.set(ScreenReaderStore.Key.startedAt, ScreenReaderStore.nowMs())
        ScreenReaderStore.set(ScreenReaderStore.Key.ticks, 0)
        ScreenReaderStore.set(ScreenReaderStore.Key.changedFrames, 0)
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "reading")
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        // Cheap early exit: ReplayKit calls this up to 60×/sec, we only want video ~1×/sec.
        guard sampleBufferType == .video else { return }
        let now = Date().timeIntervalSince1970
        guard now - lastSampleAt >= sampleInterval else { return }
        lastSampleAt = now

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        guard let hash = fingerprint(pixelBuffer) else {
            fail("Unsupported screen format")
            return
        }

        ticks += 1
        if hash != lastHash {
            changedFrames += 1
            lastHash = hash
            // Phase 2: hand the pixel buffer to the Vision OCR classifier here.
            // It must not be retained after this method returns.
        }

        // Heartbeat every sample, changed or not. The app uses this to tell "reading" from "dead".
        ScreenReaderStore.set(ScreenReaderStore.Key.ticks, ticks)
        ScreenReaderStore.set(ScreenReaderStore.Key.changedFrames, changedFrames)
        ScreenReaderStore.set(ScreenReaderStore.Key.lastTickAt, ScreenReaderStore.nowMs())
    }

    override func broadcastPaused() {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "stopped")
    }

    override func broadcastResumed() {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "reading")
    }

    override func broadcastFinished() {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "stopped")
    }

    // Record the reason in the App Group first, so the app's card can show it, then end the broadcast.
    private func fail(_ reason: String) {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "failed")
        ScreenReaderStore.set(ScreenReaderStore.Key.error, reason)
        finishBroadcastWithError(NSError(domain: "DelivrScreenReader", code: 1,
            userInfo: [NSLocalizedDescriptionKey: reason]))
    }

    // Hash of a coarse grid of luma-like bytes. Two frames with the same hash are treated as identical.
    private func fingerprint(_ pixelBuffer: CVPixelBuffer) -> UInt64? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        // ReplayKit usually delivers planar YpCbCr: plane 0 is luma. Packed formats (BGRA) have no planes.
        let planar = CVPixelBufferIsPlanar(pixelBuffer)
        let base = planar ? CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) : CVPixelBufferGetBaseAddress(pixelBuffer)
        let width = planar ? CVPixelBufferGetWidthOfPlane(pixelBuffer, 0) : CVPixelBufferGetWidth(pixelBuffer)
        let height = planar ? CVPixelBufferGetHeightOfPlane(pixelBuffer, 0) : CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = planar ? CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0) : CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let base = base, width > 0, height > 0 else { return nil }

        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var hash: UInt64 = 0xcbf29ce484222325           // FNV-1a offset basis
        for gy in 0..<grid {
            let y = (gy * height) / grid
            for gx in 0..<grid {
                let x = (gx * width) / grid
                hash ^= UInt64(bytes[y * bytesPerRow + x])
                hash = hash &* 0x100000001b3            // FNV-1a prime
            }
        }
        return hash
    }
}
