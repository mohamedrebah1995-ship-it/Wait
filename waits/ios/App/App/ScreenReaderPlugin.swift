import Foundation
import UIKit
import ReplayKit
import Capacitor

// ── SCREEN READER — Start shift + status (Phase 1) ───────────────────────────
// Opens ReplayKit's system broadcast sheet, preselected to DelivrScreenReader, with the microphone off.
// The driver still confirms in the iOS sheet. Delivr can't start or stop a broadcast by itself, so
// "stop" is done from the red status-bar pill or Control Center.
//
// The extension writes its status to the App Group (see SharedStore.swift). This plugin only reads it.

// `cap sync` only lists plugins from npm packages in capacitor.config.json, so a local plugin listed
// there by hand is dropped on the next sync. Registering it here survives every sync.
class DelivrBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenReaderPlugin())
    }
}

@objc(ScreenReaderPlugin)
public class ScreenReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenReaderPlugin"
    public let jsName = "ScreenReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startShift", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recentEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEvaluateAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endRun", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFix", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAverageRate", returnType: CAPPluginReturnPromise),
    ]

    // Older logs could contain street addresses (Uber package pickups). Delete them once on upgrade.
    override public func load() {
        if ScreenReaderStore.int(ScreenReaderStore.Key.logVersion) < ScreenReaderStore.currentLogVersion {
            EventLog.clear()
            ScreenReaderStore.set(ScreenReaderStore.Key.logVersion, ScreenReaderStore.currentLogVersion)
        }
    }

    @objc func startShift(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else {
                call.reject("Could not open the screen broadcast sheet")
                return
            }
            let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
            picker.preferredExtension = ScreenReaderStore.extensionBundleId
            picker.showsMicrophoneButton = false
            host.addSubview(picker)

            // The picker wraps a single UIButton. Pressing it presents the system sheet.
            // Apple intends this to be tapped by the user, so if iOS ignores the programmatic press
            // the driver sees an error in the card and can retry.
            guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
                picker.removeFromSuperview()
                call.reject("Screen broadcast is not available on this iOS version")
                return
            }
            button.sendActions(for: .touchUpInside)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { picker.removeFromSuperview() }
            call.resolve()
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(ScreenReaderStore.snapshot())
    }

    // The extension calls /evaluate with the driver's Firebase ID token. The app refreshes it whenever
    // Firebase does (~hourly while the app is open); an expired token just means an offline estimate.
    @objc func setEvaluateAuth(_ call: CAPPluginCall) {
        ScreenReaderStore.set(ScreenReaderStore.Key.evalURL, call.getString("url") ?? "")
        ScreenReaderStore.set(ScreenReaderStore.Key.evalToken, call.getString("token") ?? "")
        call.resolve()
    }

    // Driver's own position, already rounded to ~100 m by the web layer, with the time it was taken.
    @objc func setFix(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else { return call.reject("lat/lng required") }
        ScreenReaderStore.set(ScreenReaderStore.Key.fix, [lat, lng, ScreenReaderStore.nowMs()])
        call.resolve()
    }

    @objc func setAverageRate(_ call: CAPPluginCall) {
        if let r = call.getDouble("rate"), r > 0 { ScreenReaderStore.set(ScreenReaderStore.Key.avgRate, r) }
        call.resolve()
    }

    // Manual End run. The extension also checks this flag every second, so a running broadcast resets.
    @objc func endRun(_ call: CAPPluginCall) {
        ScreenReaderStore.set(ScreenReaderStore.Key.runEndedAt, ScreenReaderStore.nowMs())
        ScreenReaderStore.set(ScreenReaderStore.Key.runOrders, 0)
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ScreenReaderStore.appGroup)?
            .appendingPathComponent("run-state.json") {
            try? FileManager.default.removeItem(at: url)
        }
        call.resolve()
    }

    // Last N events from the App Group log (newest last). Debug sheet only.
    @objc func recentEvents(_ call: CAPPluginCall) {
        let n = max(1, min(call.getInt("limit") ?? 5, 50))
        call.resolve(["events": EventLog.last(n)])
    }
}
