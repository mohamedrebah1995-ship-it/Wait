import Foundation

// Expected result per fixture, from fixtures/*/README.md. Only listed fields are checked; flags are a
// subset check (a screen may show more flags than the README lists).
// Corrected against the screenshots (README typo → what the screen shows):
//   uber/15 miles 4.1 → 3.4, justeat/40 miles 5.9 → 0.9, justeat/43 miles 3.6 → 1.6.

struct Expect {
    var type: EventType
    var pay: Double? = nil
    var minutes: Int? = nil
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
    var pending: Bool? = nil
    var earningsToday: Double? = nil
    var noRoute = false              // minutes and miles must be nil (Deliveroo)
    var offerType: String? = nil
}

let D = OfferType.delivery

let expectations: [String: Expect] = [
    // ── Uber Eats
    "uber/01_offline_with_promo": Expect(type: .unknown),
    "uber/02_online_waiting": Expect(type: .unknown),
    "uber/03_online_waiting_lowres": Expect(type: .unknown),
    "uber/10_new_offer_842": Expect(type: .newOffer, pay: 8.42, minutes: 31, miles: 8.0, restaurant: "Majestic Wine - Braintree",
                                    dropPostcode: "CO9 1BD", flags: [Flag.exclusive, Flag.mustVerifyID], offerType: D),
    "uber/11_new_offer_950": Expect(type: .newOffer, pay: 9.50, minutes: 34, miles: 10.0, restaurant: "wagamama (Braintree Village)",
                                    dropPostcode: "CO5 9JU", offerType: D),
    "uber/12_new_offer_607_lowres": Expect(type: .newOffer, pay: 6.07, minutes: 22, miles: 3.6, restaurant: "McDonald's",
                                           flags: [Flag.customerVerification], offerType: D),
    "uber/13_addon_offer_304_lowres": Expect(type: .newOffer, pay: 3.04, minutes: 11, miles: 1.4, restaurant: "McDonald's",
                                             offerType: OfferType.addOn),
    "uber/14_offer_accepting_loading_lowres": Expect(type: .orderAccepted, pay: 6.07, minutes: 22, miles: 3.6, restaurant: "McDonald's",
                                                     offerType: D),
    "uber/15_new_offer_570_lowres": Expect(type: .newOffer, pay: 5.70, minutes: 21, miles: 3.4,
                                           restaurant: "Coco di Mama - Pasta & Pizza (Braintree)", offerType: D),
    "uber/20_nav_to_restaurant_lowres": Expect(type: .unknown),
    "uber/21_trip_guide_pickup_lowres": Expect(type: .unknown),
    "uber/22_at_restaurant_pickup_lowres": Expect(type: .arrived, restaurant: "McDonald's"),
    "uber/30_trip_guide_dropoff_lowres": Expect(type: .pickedUp),
    "uber/31_nav_to_customer_lowres": Expect(type: .unknown),
    "uber/32_at_customer_dropoff_lowres": Expect(type: .unknown),
    "uber/33_leave_at_door_photo_lowres": Expect(type: .delivered),
    "uber/40_offline_with_promo_lowres": Expect(type: .unknown),

    // ── Just Eat
    "justeat/10_new_offer_883": Expect(type: .newOffer, pay: 8.83, miles: 6.2, stops: 2,
                                       restaurant: "Five Guys - Burgers and Fries - Braintree Freeport", dropPostcode: "CM7 2QY",
                                       flags: [Flag.includesBonus], countdownSec: 41, pickupETA: "2:31 PM", dropETA: "2:48 PM", offerType: D),
    "justeat/20_heading_to_restaurant_ive_arrived_button": Expect(type: .orderAccepted,
                                       restaurant: "Five Guys - Burgers and Fries - Braintree Freeport"),
    "justeat/22_at_restaurant_picked_up_button": Expect(type: .arrived),
    "justeat/30_heading_to_customer_starting_route": Expect(type: .pickedUp),
    "justeat/31_heading_to_customer_ive_arrived_button": Expect(type: .unknown),
    "justeat/32_deliver_order_code_required": Expect(type: .unknown),
    "justeat/33_enter_delivery_code": Expect(type: .unknown),
    "justeat/34_code_valid_delivered": Expect(type: .delivered),
    "justeat/40_new_offer_686": Expect(type: .newOffer, pay: 6.86, miles: 0.9, stops: 2, restaurant: "Greggs - Braintree", countdownSec: 57,
                                       offerType: D),
    "justeat/41_decline_are_you_sure": Expect(type: .offerDeclined, pending: true),
    "justeat/42_offer_declined_idle_earnings_883": Expect(type: .offerDeclined, earningsToday: 8.83),
    "justeat/43_new_offer_504": Expect(type: .newOffer, pay: 5.04, miles: 1.6, stops: 2, restaurant: "Greggs - Braintree", offerType: D),
    "justeat/44_new_offer_461_age_restricted": Expect(type: .newOffer, pay: 4.61, miles: 1.5,
                                       restaurant: "Tesco - Braintree Marks Farm Superstore", flags: [Flag.ageRestricted], offerType: D),

    // ── Deliveroo
    "deliveroo/01_idle_finding_orders": Expect(type: .unknown),
    "deliveroo/10_new_offer_536": Expect(type: .newOffer, pay: 5.36, orders: 1, restaurant: "McDonald's",
                                         pickupPostcode: "CM77 8EZ", dropPostcode: "CM7 9JY", noRoute: true, offerType: D),
    "deliveroo/20_go_to_restaurant": Expect(type: .orderAccepted, restaurant: "McDonald's"),
    "deliveroo/21_at_restaurant_check_in": Expect(type: .arrived),
    "deliveroo/22_collect_order_go_to_customer": Expect(type: .pickedUp),
    "deliveroo/30_go_to_customer": Expect(type: .unknown),
    "deliveroo/31_find_customer_arrived_button": Expect(type: .unknown),
    "deliveroo/32_deliver_order_confirm_code": Expect(type: .unknown),
    "deliveroo/33_enter_code_confirm_delivery": Expect(type: .delivered),
]

// Returns the list of mismatches (empty = PASS).
func check(_ e: ScreenEvent?, _ x: Expect) -> [String] {
    let type = e?.type ?? .unknown
    if type != x.type { return ["type \(type.rawValue) ≠ \(x.type.rawValue)"] }
    guard let e = e else { return [] }
    var bad: [String] = []
    func cmp<T: Equatable>(_ name: String, _ got: T?, _ want: T?) {
        if let w = want, got != w { bad.append("\(name) \(got.map { "\($0)" } ?? "nil") ≠ \(w)") }
    }
    cmp("offerType", e.offerType, x.offerType)
    cmp("pay", e.pay, x.pay); cmp("min", e.minutes, x.minutes); cmp("mi", e.miles, x.miles)
    cmp("stops", e.stops, x.stops); cmp("orders", e.orders, x.orders); cmp("restaurant", e.restaurant, x.restaurant)
    cmp("pickupPC", e.pickupPostcode, x.pickupPostcode); cmp("dropPC", e.dropPostcode, x.dropPostcode)
    cmp("countdown", e.countdownSec, x.countdownSec); cmp("pickupETA", e.pickupETA, x.pickupETA)
    cmp("dropETA", e.dropETA, x.dropETA); cmp("pending", e.pending, x.pending); cmp("earningsToday", e.earningsToday, x.earningsToday)
    for f in x.flags where !e.flags.contains(f) { bad.append("missing flag \(f)") }
    if x.noRoute && (e.minutes != nil || e.miles != nil) { bad.append("minutes/miles should be nil") }
    bad += privacyViolations(e)
    return bad
}

// Privacy rule, checked on every event: the only location data allowed is a bare postcode.
func privacyViolations(_ e: ScreenEvent) -> [String] {
    var bad: [String] = []
    if let r = e.restaurant, Parse.isAddressLike(r) { bad.append("PRIVACY: restaurant looks like an address") }
    for (name, pc) in [("pickupPC", e.pickupPostcode), ("dropPC", e.dropPostcode)] {
        if let pc = pc, Parse.postcode(pc) != pc { bad.append("PRIVACY: \(name) is not a bare postcode") }
    }
    return bad
}
