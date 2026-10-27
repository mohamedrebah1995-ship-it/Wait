import Foundation
import Capacitor
import StoreKit

// ── STACK CHECK PLANS — StoreKit 2 (iOS in-app purchase) ─────────────────────
// Apple Guideline 3.1.1 forbids taking payment for a digital subscription through anything but
// their own IAP, which is why the web build's Stripe plan list is hidden on iOS. This plugin is
// the iOS half: the SAME plans as src/plans.js, sold through StoreKit instead.
//
// Product ids must match the ones created in App Store Connect (see PRODUCT_IDS below). The daily
// call caps are NOT duplicated here — the web layer reads them from src/plans.js, so there is
// still exactly one place where a cap is written down.
//
// ⚠️ This file is not yet a member of the App target. In Xcode: right-click the App group →
// "Add Files to App…" → select this file → tick the "App" target. Until then it is inert and the
// iOS build behaves exactly as it does today (no purchase UI at all).

@objc(StackPlansPlugin)
public class StackPlansPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StackPlansPlugin"
    public let jsName = "StackPlans"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "current",  returnType: CAPPluginReturnPromise),
    ]

    // planId (src/plans.js) → App Store Connect product id.
    private static let PRODUCT_IDS: [String: String] = [
        "basic":    "app.delivr.mobile.basic",      // £4.99/month
        "week":     "app.delivr.mobile.week",       // £6.99/week
        "month":    "app.delivr.mobile.month",      // £24.99/month
        "year":     "app.delivr.mobile.year",       // £249/year
        "weekPro":  "app.delivr.mobile.weekpro",    // £9.99/week
        "monthPro": "app.delivr.mobile.monthpro",   // £29.99/month
        "yearPro":  "app.delivr.mobile.yearpro",    // £299/year
    ]
    private static var planFor: [String: String] {
        Dictionary(uniqueKeysWithValues: PRODUCT_IDS.map { ($0.value, $0.key) })
    }

    private var updatesTask: Task<Void, Never>?

    // Transactions can arrive outside a purchase (renewal, Ask-to-Buy approval, another device),
    // so listen for the whole app lifetime and tell the web layer to re-read entitlements.
    override public func load() {
        updatesTask = Task.detached { [weak self] in
            for await update in Transaction.updates {
                guard let self, case .verified(let tx) = update else { continue }
                await tx.finish()
                await MainActor.run {
                    self.notifyListeners("plansChanged", data: ["plan": Self.planFor[tx.productID] ?? ""])
                }
            }
        }
    }

    deinit { updatesTask?.cancel() }

    // Prices come from StoreKit, already localised to the user's storefront — never hard-coded,
    // so a driver in Ireland sees euros without the app inventing a conversion.
    @objc func products(_ call: CAPPluginCall) {
        Task {
            do {
                let storeProducts = try await Product.products(for: Array(Self.PRODUCT_IDS.values))
                let payload: [[String: Any]] = storeProducts.map { p in
                    [
                        "plan": Self.planFor[p.id] ?? "",
                        "productId": p.id,
                        "price": p.displayPrice,
                        "name": p.displayName,
                    ]
                }
                call.resolve(["products": payload])
            } catch {
                call.reject("Could not load products: \(error.localizedDescription)")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let plan = call.getString("plan"), let productId = Self.PRODUCT_IDS[plan] else {
            call.reject("Unknown plan"); return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("Product not available"); return
                }
                switch try await product.purchase() {
                case .success(let verification):
                    guard case .verified(let tx) = verification else {
                        call.reject("Could not verify this purchase"); return
                    }
                    await tx.finish()
                    // The signed JWS is what the server must check before granting `plan` — the
                    // app itself never writes the entitlement (see firestore.rules).
                    call.resolve(["plan": plan, "productId": productId, "jws": verification.jwsRepresentation])
                case .userCancelled:
                    call.resolve(["cancelled": true])
                case .pending:
                    call.resolve(["pending": true])          // Ask-to-Buy — resolves later via Transaction.updates
                @unknown default:
                    call.reject("Purchase finished in an unknown state")
                }
            } catch {
                call.reject("Purchase failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            await current(call)
        }
    }

    // The entitlement actually in force right now. If a driver holds more than one, the richest
    // wins — never downgrade someone who is paying for the bigger plan.
    @objc func current(_ call: CAPPluginCall) {
        Task { await current(call) }
    }

    private func current(_ call: CAPPluginCall) async {
        let rank = ["basic": 1, "week": 2, "month": 3, "year": 4, "weekPro": 5, "monthPro": 6, "yearPro": 7]
        var best: String?
        var bestJws: String?
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let tx) = entitlement,
                  let plan = Self.planFor[tx.productID] else { continue }
            if best == nil || (rank[plan] ?? 0) > (rank[best!] ?? 0) {
                best = plan
                bestJws = entitlement.jwsRepresentation
            }
        }
        call.resolve(["plan": best ?? "", "jws": bestJws ?? ""])
    }
}
