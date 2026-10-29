import Foundation
import UIKit
import ReplayKit
import UserNotifications
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
        CAPPluginMethod(name: "runOrders", returnType: CAPPluginReturnPromise),
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
        // Verdicts arrive as notifications from the extension, so ask first (iOS only shows this once;
        // after that it's a no-op and the driver manages it in Settings).
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            self.presentBroadcastPicker(call)
        }
    }

    private func presentBroadcastPicker(_ call: CAPPluginCall) {
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
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            var snap = ScreenReaderStore.snapshot()
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: snap["notifications"] = "allowed"
            case .denied: snap["notifications"] = "denied"
            default: snap["notifications"] = "not asked"
            }
            snap["timeSensitive"] = settings.timeSensitiveSetting == .enabled
            // What actually decides a pop-up: "allowed" alone also covers Deliver Quietly.
            snap["quiet"] = settings.authorizationStatus == .provisional
            snap["banners"] = settings.alertSetting == .enabled
            snap["sounds"] = settings.soundSetting == .enabled
            snap["summary"] = settings.scheduledDeliverySetting == .enabled
            call.resolve(snap)
        }
    }

    // The extension calls /evaluate signed in as the driver. The app stores Firebase's refresh token in the
    // shared keychain (see SharedAuth.swift); the extension mints fresh ID tokens from it for the whole
    // shift. An empty refresh token (signed out) deletes it.
    @objc func setEvaluateAuth(_ call: CAPPluginCall) {
        ScreenReaderStore.set(ScreenReaderStore.Key.evalURL, call.getString("url") ?? "")
        ScreenReaderStore.set("sr.evalToken", nil)   // older builds kept the ID token here; it now lives in the keychain
        let refresh = call.getString("refreshToken") ?? ""
        if refresh.isEmpty {
            SharedAuth.save(nil)
            ScreenReaderStore.set(ScreenReaderStore.Key.authState, "reconnect")
        } else {
            let saved = SharedAuth.save(SharedAuth.Tokens(refreshToken: refresh, idToken: call.getString("token") ?? "",
                                                          expiresAt: call.getDouble("expiresAt") ?? 0, apiKey: call.getString("apiKey") ?? ""))
            // Read back what the extension will read, so "ok" means the shared keychain really has it.
            let readable = saved && SharedAuth.load()?.refreshToken == refresh
            ScreenReaderStore.set(ScreenReaderStore.Key.authState, readable ? "ok" : "keychain-failed")
        }
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

    // The extension's current run (run-state.json), for the Stack Check map. Dates come out as epoch ms;
    // `id` is the extension's RunOrder.id (platform + accepted ms), stable for the order's life.
    @objc func runOrders(_ call: CAPPluginCall) {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ScreenReaderStore.appGroup)?
                .appendingPathComponent("run-state.json"),
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let orders = obj["orders"] as? [[String: Any]] else { call.resolve(["orders": []]); return }
        let ms = { (v: Any?) -> Double? in (v as? Double).map { ($0 + Date.timeIntervalBetween1970AndReferenceDate) * 1000 } }
        call.resolve(["orders": orders.map { o -> [String: Any] in
            var r = o
            for k in ["acceptedAt", "arrivedAt", "pickedUpAt"] { r[k] = ms(o[k]) }
            r["id"] = "\(o["platform"] as? String ?? "")-\(Int(ms(o["acceptedAt"]) ?? 0))"
            return r.compactMapValues { $0 is NSNull ? nil : $0 }
        }])
    }

    // Last N events from the App Group log (newest last). Debug sheet only.
    @objc func recentEvents(_ call: CAPPluginCall) {
        let n = max(1, min(call.getInt("limit") ?? 5, 50))
        call.resolve(["events": EventLog.last(n)])
    }
}
