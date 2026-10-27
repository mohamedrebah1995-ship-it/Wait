// ── PLANS & STACK-CHECK QUOTAS ────────────────────────────────────────────────
// Single source of truth for pricing and the Stack Check call budget. The web app, the server
// (Stripe price mapping) and the iOS build (StoreKit product ids) all read the SAME table from
// here, so a number is never written down twice and can never drift between platforms.
//
// Every plan resolves to ONE number the app actually enforces: `dailyCap` — the most Stack Check
// runs a driver can make in a day. Plans quoted per month/year are divided down to a daily cap
// (that's the "divided by a month / by 365" rule), so a driver can never burn a year's budget in
// a week and then sit blocked for eleven months.
//
// A Stack Check run costs a real Mapbox Matrix request, which is why it's metered at all.

// Paid plans all carry the ORIGINAL £4.99 Premium perks (no ads, full community data, all area
// chats, log export). Adding the stack budget on top never takes away something already paid for.
const PAID_PERKS = { noAds: true, fullData: true, allChats: true, export: true };

export const PLANS = {
  // STACK CHECK ONLY. This is not a trial of Premium and never touches ads, community data or
  // chats — it exists so a new driver can try stacking before paying for anything. No paid plan
  // on this list carries a free trial: buying one takes effect immediately.
  trial: {
    id: "trial", name: "Free trial", tier: "trial",
    priceLabel: "Free", per: "3 days", amount: 0,
    trialDays: 3,
    daily: 30,
    perks: { noAds: false, fullData: false, allChats: false, export: false },
    blurb: "3 days of stacking, 30 checks a day.",
  },
  basic: {
    id: "basic", name: "Basic", tier: "basic",
    priceLabel: "£4.99", per: "month", amount: 4.99, interval: "month",
    everyHours: 3,                 // one stack check per 3 hours = 8/day, live the moment they buy
    perks: PAID_PERKS,
    blurb: "Ads removed. 8 stack checks a day (one every 3 hours).",
  },

  // ── Standard ladder ──
  week: {
    id: "week", name: "Weekly", tier: "standard",
    priceLabel: "£6.99", per: "week", amount: 6.99, interval: "week",
    daily: 30,
    perks: PAID_PERKS,
    blurb: "Full access. 30 checks a day (210 a week).",
  },
  month: {
    id: "month", name: "Monthly", tier: "standard",
    priceLabel: "£24.99", per: "month", amount: 24.99, interval: "month",
    quota: 1000, quotaPer: "month",
    perks: PAID_PERKS,
    blurb: "1,000 checks a month, spread daily.",
  },
  year: {
    id: "year", name: "Yearly", tier: "standard", badge: "BEST VALUE",
    priceLabel: "£249", per: "year", amount: 249, interval: "year",
    quota: 15000, quotaPer: "year",
    perks: PAID_PERKS,
    blurb: "15,000 checks a year, spread daily.",
  },

  // ── Pro ladder ──
  weekPro: {
    id: "weekPro", name: "Weekly Pro", tier: "pro",
    priceLabel: "£9.99", per: "week", amount: 9.99, interval: "week",
    daily: 50,
    perks: PAID_PERKS,
    blurb: "50 checks a day (350 a week).",
  },
  monthPro: {
    id: "monthPro", name: "Monthly Pro", tier: "pro",
    priceLabel: "£29.99", per: "month", amount: 29.99, interval: "month",
    quota: 2000, quotaPer: "month",
    perks: PAID_PERKS,
    blurb: "2,000 checks a month, spread daily.",
  },
  yearPro: {
    id: "yearPro", name: "Yearly Pro", tier: "pro", badge: "MOST CHECKS",
    priceLabel: "£299", per: "year", amount: 299, interval: "year",
    quota: 30000, quotaPer: "year",
    perks: PAID_PERKS,
    blurb: "30,000 checks a year, spread daily.",
  },
};

export const PLAN_IDS = Object.keys(PLANS);
export const PAID_PLAN_IDS = PLAN_IDS.filter(id => PLANS[id].amount > 0);

// ── THE BILLING SWITCH ────────────────────────────────────────────────────────
// Stack Check shipped free to everyone. Enforcing the cap the moment this code deploys would lock
// every existing driver out of a feature they already use — and until the Stripe prices exist they
// could not buy their way back in. So the budget is TRACKED but never ENFORCED until this is true.
//
// Flip to true only once: (1) the Stripe prices are created and set on Railway (see PLAN_PRICES in
// server/index.js), and (2) drivers have been told the free run is ending.
export const PRICING_LIVE = false;

// Drivers who joined before pricing existed shouldn't find their trial already burnt through — a
// two-year-old account would otherwise start at "expired". Their 3 days run from launch instead.
export const PRICING_LAUNCH = Date.parse("2026-08-18T00:00:00Z");

// Divisors for turning a period quota into a daily allowance. 30/365 rather than the real month
// length so the cap is the same every month — a driver's budget shouldn't shrink in February.
const DAYS_PER = { month: 30, year: 365, week: 7 };

// The one number everything enforces.
export function dailyCap(planId) {
  const p = PLANS[planId];
  if (!p) return 0;
  if (p.daily != null) return p.daily;
  if (p.everyHours) return Math.floor(24 / p.everyHours);      // basic: 24/3 = 8
  if (p.quota && p.quotaPer) return Math.floor(p.quota / (DAYS_PER[p.quotaPer] || 30));
  return 0;
}

// "30 a day" / "1,000 a month (33 a day)" — one phrasing, used by every surface.
export function capLabel(planId) {
  const p = PLANS[planId];
  if (!p) return "";
  const d = dailyCap(planId);
  if (p.everyHours) return `1 check every ${p.everyHours}h · ${d}/day`;
  if (p.quota) return `${p.quota.toLocaleString()}/${p.quotaPer} · ${d}/day`;
  return `${d} checks/day`;
}

// ── Which plan is this driver on? ─────────────────────────────────────────────
// `plan` is written ONLY by the Stripe webhook / StoreKit verification (Admin SDK), never by the
// client — see firestore.rules. Legacy subscribers from before this table existed have premium=true
// and no plan; they map to `basic`, which is why basic carries the full original perk set.
export function planOf(user) {
  if (!user) return null;
  const id = user.plan;
  if (id && PLANS[id]) return id;
  if (user.premium) return "basic";        // legacy £4.99 Premium — keeps every perk it always had
  return null;
}

// Trial is derived from account creation, not a client-written flag, so clearing app storage or
// signing out can't hand someone a fresh 3 days.
export function trialDaysLeft(user, now = Date.now()) {
  const created = Date.parse(user?.createdAt || "") || null;
  if (!created) return 0;
  const started = Math.max(created, PRICING_LAUNCH);   // existing drivers get their 3 days from launch
  const left = PLANS.trial.trialDays - Math.floor((now - started) / 86400000);
  return left > 0 ? left : 0;
}

// The plan actually in force right now: a real subscription, else the trial while it lasts.
export function effectivePlan(user, now = Date.now()) {
  const paid = planOf(user);
  if (paid) return paid;
  return trialDaysLeft(user, now) > 0 ? "trial" : null;
}

export function hasStackAccess(user, now = Date.now()) {
  return effectivePlan(user, now) != null;
}

// ── Usage ─────────────────────────────────────────────────────────────────────
export const todayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// Usage resets on date change, so a stale counter from yesterday reads as 0 rather than blocking.
export function usedToday(usage, now = Date.now()) {
  if (!usage || usage.day !== todayKey(now)) return 0;
  return usage.count || 0;
}

export function bumpUsage(usage, now = Date.now()) {
  const day = todayKey(now);
  return (!usage || usage.day !== day) ? { day, count: 1 } : { day, count: (usage.count || 0) + 1 };
}

// The full picture one call, so callers never re-derive the rules themselves.
export function quotaState(user, usage, now = Date.now()) {
  const plan = effectivePlan(user, now);
  const used = usedToday(usage, now);
  // Before billing goes live nothing is ever blocked — usage is still counted, so there's real data
  // on what drivers actually need before a cap is switched on.
  if (!PRICING_LIVE) {
    const cap = dailyCap(plan || "trial");
    return { plan: plan || "trial", allowed: true, cap, used, left: Math.max(0, cap - used), reason: null, enforced: false };
  }
  if (!plan) return { plan: null, allowed: false, cap: 0, used, left: 0, reason: "no-plan", enforced: true };
  const cap = dailyCap(plan);
  const left = Math.max(0, cap - used);
  return { plan, allowed: left > 0, cap, used, left, reason: left > 0 ? null : "cap-reached", enforced: true };
}
