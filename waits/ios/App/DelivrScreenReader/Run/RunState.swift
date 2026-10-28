import Foundation

// The current run, kept in the extension (the app may be asleep). Persisted to the App Group so it
// survives the extension restarting. Postcodes, restaurant names and numbers only.
//
// IDLE until the first ORDER_ACCEPTED → ACTIVE. Back to IDLE when every order is delivered or
// cancelled, after 60 minutes with no change, or when the driver taps End run in the app.
struct RunOrder: Codable {
    var platform: Platform
    var restaurant: String?
    var pickupPostcode: String?
    var dropPostcode: String?
    var pay: Double?
    var minutes: Int?
    var miles: Double?
    var pickedUp = false
    var acceptedAt: Date
}

struct RunState: Codable {
    var orders: [RunOrder] = []
    var lastChange = Date()
    var pendingOffers: [String: ScreenEvent] = [:]     // last NEW_OFFER per platform, until accepted/declined

    static let idleTimeout: TimeInterval = 60 * 60
    var active: Bool { !orders.isEmpty }

    // MARK: persistence
    private static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ScreenReaderStore.appGroup)?
            .appendingPathComponent("run-state.json")
    }

    static func load() -> RunState {
        guard let url = url, let data = try? Data(contentsOf: url),
              let s = try? JSONDecoder().decode(RunState.self, from: data) else { return RunState() }
        return s
    }

    func save() {
        guard let url = Self.url, let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: url, options: .atomic)
        ScreenReaderStore.set(ScreenReaderStore.Key.runOrders, orders.count)
    }

    // MARK: transitions
    // Returns true when the event is an offer that should be evaluated (a run is active).
    mutating func apply(_ e: ScreenEvent) -> Bool {
        let key = e.platform.rawValue
        switch e.type {
        case .newOffer:
            pendingOffers[key] = e
            return active
        case .orderAccepted:
            let src = (e.pay != nil ? e : pendingOffers[key]) ?? e
            orders.append(RunOrder(platform: e.platform, restaurant: src.restaurant ?? e.restaurant,
                                   pickupPostcode: src.pickupPostcode, dropPostcode: src.dropPostcode,
                                   pay: src.pay, minutes: src.minutes, miles: src.miles, acceptedAt: e.at))
            pendingOffers[key] = nil
        case .pickedUp:
            if let i = orders.firstIndex(where: { $0.platform == e.platform && !$0.pickedUp }) { orders[i].pickedUp = true }
        case .delivered:
            if let i = orders.firstIndex(where: { $0.platform == e.platform && $0.pickedUp }) ?? orders.firstIndex(where: { $0.platform == e.platform }) {
                orders.remove(at: i)
            }
        case .cancelled:
            if let i = orders.firstIndex(where: { $0.platform == e.platform }) { orders.remove(at: i) }
        case .offerDeclined:
            if e.pending != true { pendingOffers[key] = nil }
        default:
            return false
        }
        lastChange = e.at
        return false
    }

    // Ends the run on timeout or when the app asked. Returns true if anything changed.
    mutating func expireIfNeeded(now: Date = Date(), endRequestedAt: Double) -> Bool {
        let requested = endRequestedAt > 0 && endRequestedAt / 1000 > lastChange.timeIntervalSince1970
        guard active || !pendingOffers.isEmpty, requested || now.timeIntervalSince(lastChange) > Self.idleTimeout else { return false }
        self = RunState()
        return true
    }
}
