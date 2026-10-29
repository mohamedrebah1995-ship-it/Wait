import ReplayKit
import CoreMedia
import CoreVideo
import UserNotifications

// Broadcast Upload Extension. iOS runs this in its own process with a ~50MB memory cap.
//
// Every ~1s, three steps, each cheaper than the next:
//   1. Has the bottom 45% (where offer and status cards sit) changed?          no → skip
//   2. Gate: does it show a delivery app's button (Uber/Just Eat/Deliveroo)?   no → discard unread
//   3. OCR (Vision, on device) + rules. Recognised screens become typed events in the App Group log.
// Frames, OCR text, street addresses and customer names are never stored or sent anywhere.
class SampleHandler: RPBroadcastSampleHandler {

    private let sampleInterval: TimeInterval = 1.0
    private var lastSampleAt: TimeInterval = 0
    private var detector = ChangeDetector()
    private var ticks = 0
    private var changedFrames = 0
    private var passedGate = 0
    private var ocrPasses = 0
    private var events = 0
    private var peakMB: Double = 0
    private var debouncer = Debouncer()
    private var runState = RunState.load()
    private var lastDeliverySeenAt: TimeInterval = 0     // last time a delivery app was recognised
    private let contextWindow: TimeInterval = 3 * 60
    private let evaluator = OfferEvaluator()

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        ticks = 0; changedFrames = 0; passedGate = 0; ocrPasses = 0; events = 0
        lastSampleAt = 0
        detector = ChangeDetector()
        debouncer = Debouncer()
        peakMB = MemoryProbe.footprintMB()
        ScreenReaderStore.set(ScreenReaderStore.Key.error, "")
        ScreenReaderStore.set(ScreenReaderStore.Key.startedAt, ScreenReaderStore.nowMs())
        ScreenReaderStore.set(ScreenReaderStore.Key.ticks, 0)
        ScreenReaderStore.set(ScreenReaderStore.Key.changedFrames, 0)
        ScreenReaderStore.set(ScreenReaderStore.Key.passedGate, 0)
        ScreenReaderStore.set(ScreenReaderStore.Key.ocrPasses, 0)
        ScreenReaderStore.set(ScreenReaderStore.Key.events, 0)
        ScreenReaderStore.set(ScreenReaderStore.Key.peakMB, peakMB)
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "reading")
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        // Cheap early exit: ReplayKit calls this up to 60×/sec, we only want video ~1×/sec.
        guard sampleBufferType == .video else { return }
        let now = Date().timeIntervalSince1970
        guard now - lastSampleAt >= sampleInterval else { return }
        lastSampleAt = now

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        guard let cells = ChangeDetector.cells(pixelBuffer) else {
            fail("Unsupported screen format")
            return
        }

        ticks += 1
        if ticks % 60 == 1 { evaluator.refreshTokenIfDue() }   // keep the server sign-in fresh all shift
        let endRequested = UserDefaults(suiteName: ScreenReaderStore.appGroup)?.double(forKey: ScreenReaderStore.Key.runEndedAt) ?? 0
        if runState.expireIfNeeded(endRequestedAt: endRequested) { runState.save() }
        if detector.changed(cells) {
            changedFrames += 1
            // Layout-only screens (greyed buttons, toasts, the stop disc) are allowed only in delivery
            // context: during a run, or shortly after a delivery app was recognised.
            let inContext = runState.active || Date().timeIntervalSince1970 - lastDeliverySeenAt < contextWindow
            if let gate = PlatformGate.check(pixelBuffer, allowLayout: inContext) {
                passedGate += 1
                ScreenReaderStore.set(ScreenReaderStore.Key.passedGate, passedGate)
                if gate.accent != nil { lastDeliverySeenAt = Date().timeIntervalSince1970 }
                read(pixelBuffer, accent: gate.accent)
            }
            // No delivery-app button: the frame is dropped here, never OCR'd, nothing logged.
        }

        // Heartbeat every sample, changed or not. The app uses this to tell "reading" from "dead".
        ScreenReaderStore.set(ScreenReaderStore.Key.ticks, ticks)
        ScreenReaderStore.set(ScreenReaderStore.Key.changedFrames, changedFrames)
        ScreenReaderStore.set(ScreenReaderStore.Key.lastTickAt, ScreenReaderStore.nowMs())
    }

    // Runs synchronously on ReplayKit's callback queue: one frame in flight at a time, released when
    // this returns. Frames ReplayKit delivers meanwhile are simply skipped.
    private func read(_ pixelBuffer: CVPixelBuffer, accent: Accent?) {
        ocrPasses += 1
        autoreleasepool {
            let lines = OCR.recognize(pixelBuffer)
            let result = ScreenReaderRules.read(lines, accent: accent)
            if result.platform != nil { lastDeliverySeenAt = Date().timeIntervalSince1970 }
            if var event = result.event, debouncer.accept(event) {
                event.seq = ScreenReaderStore.nextSeq()
                EventLog.append(event)
                // Run state + offer verdict. Evaluation runs off this queue; the frame is already released.
                if runState.apply(event) { evaluator.evaluate(offer: event, run: runState.orders) }
                runState.save()
                events += 1
                ScreenReaderStore.set(ScreenReaderStore.Key.events, events)
            }
        }
        let mb = MemoryProbe.footprintMB()
        if mb > peakMB {
            peakMB = mb
            ScreenReaderStore.set(ScreenReaderStore.Key.peakMB, peakMB)
        }
        ScreenReaderStore.set(ScreenReaderStore.Key.lastMB, mb)
        ScreenReaderStore.set(ScreenReaderStore.Key.ocrPasses, ocrPasses)
    }

    override func broadcastPaused() {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "stopped")
    }

    override func broadcastResumed() {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "reading")
    }

    override func broadcastFinished() {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "stopped")
        notifyStopped()
    }

    // iOS ends a broadcast on its own (screen lock, a call, another app recording). Mid-shift that would
    // otherwise go unnoticed, so say it — only while a run is on or a delivery app was just on screen.
    private func notifyStopped() {
        guard runState.active || Date().timeIntervalSince1970 - lastDeliverySeenAt < contextWindow else { return }
        let c = UNMutableNotificationContent()
        c.title = "MOdelivr stopped reading offers"
        c.body = "Screen sharing ended. Open MOdelivr and tap Start to keep checking offers."
        c.sound = .default
        c.interruptionLevel = .active   // broadcast extensions can't hold the time-sensitive entitlement
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "screen-reader-stopped", content: c, trigger: nil))
    }

    // Record the reason in the App Group first, so the app can show it, then end the broadcast.
    private func fail(_ reason: String) {
        ScreenReaderStore.set(ScreenReaderStore.Key.state, "failed")
        ScreenReaderStore.set(ScreenReaderStore.Key.error, reason)
        finishBroadcastWithError(NSError(domain: "DelivrScreenReader", code: 1,
            userInfo: [NSLocalizedDescriptionKey: reason]))
    }
}
