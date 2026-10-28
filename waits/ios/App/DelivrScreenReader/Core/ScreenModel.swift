import Foundation

// The typed event the screen reader produces. Minimum fields only: never a customer name, never a full
// drop-off address (postcode only), never an image or raw OCR text.

enum Platform: String, Codable {
    case uber = "UBER_EATS"
    case justEat = "JUST_EAT"
    case deliveroo = "DELIVEROO"
}

enum EventType: String, Codable {
    case newOffer = "NEW_OFFER"
    case orderAccepted = "ORDER_ACCEPTED"
    case arrived = "ARRIVED"
    case pickedUp = "PICKED_UP"
    case delivered = "DELIVERED"
    case cancelled = "CANCELLED"
    case offerDeclined = "OFFER_DECLINED"
    case earnings = "EARNINGS"
    case unknown = "UNKNOWN"
}

enum Flag {
    static let exclusive = "Exclusive"
    static let mustVerifyID = "Must verify ID"
    static let customerVerification = "Customer verification"
    static let ageRestricted = "Age-restricted"
    static let includesBonus = "Includes bonus"
    static let heavy = "Heavy"
}

// Offers only. Package pickups are often a private home: those never get a restaurant name, postcode only.
enum OfferType {
    static let delivery = "Delivery"
    static let package = "Package"
    static let addOn = "Add-on"
}

struct ScreenEvent: Codable {
    var platform: Platform
    var type: EventType
    var at: Date = Date()
    var seq: Int? = nil              // per-device sequence number, set when logged (sync de-duplication)
    var offerType: String? = nil     // OfferType, on NEW_OFFER / ORDER_ACCEPTED only
    var pay: Double? = nil
    var minutes: Int? = nil          // nil when the platform doesn't show it (Deliveroo, Just Eat)
    var miles: Double? = nil
    var stops: Int? = nil
    var orders: Int? = nil
    var restaurant: String? = nil
    var pickupPostcode: String? = nil
    var dropPostcode: String? = nil
    var flags: [String] = []
    var countdownSec: Int? = nil
    var pickupETA: String? = nil
    var dropETA: String? = nil
    var pending: Bool? = nil         // Just Eat "Are you sure?": decline not confirmed yet
    var earningsToday: Double? = nil
    var cancellationFee: Double? = nil

    // Same screen → same key. Leaves out the countdown and timestamp, which change every frame.
    var dedupeKey: String {
        [platform.rawValue, type.rawValue,
         pay.map { String(format: "%.2f", $0) } ?? "",
         restaurant ?? "", minutes.map(String.init) ?? "",
         miles.map { String(format: "%.1f", $0) } ?? "", dropPostcode ?? "",
         pending == true ? "pending" : ""].joined(separator: "|")
    }
}
