// ── iOS IN-APP PURCHASE BRIDGE ────────────────────────────────────────────────
// Talks to StackPlansPlugin.swift (StoreKit 2). Apple Guideline 3.1.1 means the iOS build can't
// send drivers to Stripe, so on iOS the plan list is sold through StoreKit instead.
//
// Everything here fails SOFT. If the native plugin isn't in the Xcode target yet, or the products
// haven't been created in App Store Connect, `iapAvailable()` returns false and the app shows no
// purchase UI at all on iOS — exactly the behaviour it has today. Nothing half-built reaches a
// driver, and no purchase button can appear that wouldn't work.

import { Capacitor, registerPlugin } from "@capacitor/core";

const IS_IOS = Capacitor.getPlatform() === "ios";
const StackPlans = IS_IOS ? registerPlugin("StackPlans") : null;

let cached = null;   // null = not asked yet, [] = asked and unavailable

// StoreKit-priced products, keyed by the plan ids in plans.js. Prices come from StoreKit rather
// than our own table so they're localised to the driver's storefront.
export async function iapProducts() {
  if (!StackPlans) return [];
  if (cached) return cached;
  try {
    const r = await StackPlans.products();
    cached = Array.isArray(r?.products) ? r.products.filter(p => p.plan) : [];
  } catch {
    cached = [];
  }
  return cached;
}

export async function iapAvailable() {
  return (await iapProducts()).length > 0;
}

// Returns the signed transaction (JWS). The app never grants itself a plan — `plan` is locked in
// firestore.rules — so this must go to the server to be verified before the entitlement is set.
export async function iapPurchase(planId) {
  if (!StackPlans) throw new Error("In-app purchase unavailable");
  const r = await StackPlans.purchase({ plan: planId });
  if (r?.cancelled) return { cancelled: true };
  if (r?.pending) return { pending: true };
  return { plan: r?.plan || planId, jws: r?.jws || "" };
}

export async function iapRestore() {
  if (!StackPlans) return { plan: "" };
  try { return await StackPlans.restore(); } catch { return { plan: "" }; }
}

export async function iapCurrent() {
  if (!StackPlans) return { plan: "" };
  try { return await StackPlans.current(); } catch { return { plan: "" }; }
}

export { IS_IOS as IAP_PLATFORM_IOS };
