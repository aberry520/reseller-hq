// Pricing — pure functions, no React Native imports, unit-testable.
// See src/lib/pricing.test.ts for the worked examples.
//
// MAC.BID all-in (Anderson, SC), from mac.bid's FAQ:
//   buyer's premium 15% of the winning bid + $3 lot fee per item + sales tax.
//   Anderson combined sales tax is 7% (6% state + 1% special district).
//   A $10 transfer fee applies when the lot has to be transferred to Anderson.
//   Transfer fee is added AFTER tax — that is an assumption; check an invoice
//   if a transfer lot ever looks off by ~$0.70.
//
// eBay: fee 13.6%, target margin 30% (Austin's latest decision — the old sheet
// formulas used 13%, the app uses 13.6% everywhere).
//   min eBay price = (allInCost + estShip) / (1 - 0.136 - 0.30) = / 0.564
//   profit = sold - allIn - ship - 0.136 * sold
//   margin = profit / sold
//
// Facebook: round UP to the nearest $5 of (eBayPrice - estShip - 0.136 * eBayPrice),
// so there is room to negotiate. Example: $100 eBay, $15 ship -> $71.40 -> $75.

export const MACBID_PREMIUM_PCT = 0.15;
export const MACBID_LOT_FEE = 3;
export const MACBID_TRANSFER_FEE = 10;
export const DEFAULT_TAX_PCT = 0.07;

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  return `$${roundMoney(n).toFixed(2)}`;
}

/** All-in MAC.BID cost for a winning bid. `transferable` = lot must be moved to Anderson. */
export function macBidAllIn(bid: number, transferable = false, taxPct = DEFAULT_TAX_PCT): number {
  const subtotal = bid * (1 + MACBID_PREMIUM_PCT) + MACBID_LOT_FEE;
  const withTax = subtotal * (1 + taxPct);
  return roundMoney(withTax + (transferable ? MACBID_TRANSFER_FEE : 0));
}

/** Lowest eBay price (free shipping included) that still hits the target margin. */
export function minEbayPrice(
  allInCost: number,
  estShip: number,
  feePct = 0.136,
  targetMarginPct = 0.3,
): number {
  const denom = 1 - feePct - targetMarginPct;
  if (denom <= 0) return Infinity;
  return roundMoney((allInCost + estShip) / denom);
}

export function ebayProfit(
  soldPrice: number,
  allInCost: number,
  shipCost: number,
  feePct = 0.136,
): number {
  return roundMoney(soldPrice - allInCost - shipCost - feePct * soldPrice);
}

export function ebayMargin(
  soldPrice: number,
  allInCost: number,
  shipCost: number,
  feePct = 0.136,
): number {
  if (soldPrice <= 0) return 0;
  return ebayProfit(soldPrice, allInCost, shipCost, feePct) / soldPrice;
}

/**
 * Margin as a percentage rounded to 1 decimal — the same precision the app
 * displays. Compare on this, not the raw float: a true 30.0% can compute as
 * 0.29995… and would otherwise read as a fail.
 */
export function marginPct(margin: number): number {
  return Math.round(margin * 1000) / 10;
}

export function passesMargin(
  soldPrice: number,
  allInCost: number,
  shipCost: number,
  feePct = 0.136,
  targetMarginPct = 0.3,
): boolean {
  return marginPct(ebayMargin(soldPrice, allInCost, shipCost, feePct)) >= targetMarginPct * 100;
}

/** Facebook price: eBay price minus shipping and the eBay fee, rounded UP to the next $5. */
export function facebookPrice(ebayPrice: number, estShip: number, feePct = 0.136): number {
  const raw = ebayPrice - estShip - feePct * ebayPrice;
  if (raw <= 0) return 0;
  // Subtract a tiny epsilon so an exact multiple of $5 (e.g. $70.00) stays $70, not $75.
  return Math.ceil((raw - 1e-9) / 5) * 5;
}

/**
 * Suggested eBay price for an item: the research / sold-comp price when one
 * is recorded, otherwise the minimum price that hits the target margin.
 */
export function suggestedEbayPrice(
  allInCost: number,
  estShip: number,
  researchPrice: number,
  feePct = 0.136,
  targetMarginPct = 0.3,
): number {
  if (researchPrice > 0) return roundMoney(researchPrice);
  return minEbayPrice(allInCost, estShip, feePct, targetMarginPct);
}
