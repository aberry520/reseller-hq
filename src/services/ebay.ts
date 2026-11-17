// eBay — PLACEHOLDER in v1. Do NOT call the eBay API from here yet.
//
// Austin's decision (2026-11-16): connect eBay when needed. Setting it up
// requires a human step first:
//   1. Join the eBay Developers Program (developer.ebay.com) — approval can
//      take about one business day.
//   2. Create a Production keyset (App ID / Cert ID) and a RuName.
//   3. OAuth with scopes sell.inventory + sell.account, opt in to Business
//      Policies (payment / fulfillment / return), create an inventory location.
//   4. Then the Inventory API flow is:
//      PUT /sell/inventory/v1/inventory_item/{sku}
//      POST /sell/inventory/v1/offer
//      POST /sell/inventory/v1/offer/{offerId}/publish
//
// When that is done, implement this service for real and remove the
// `notConnected` guard. Until then every function returns a clear
// 'not connected yet' result instead of failing silently.

import type { Item } from '../lib/types';

export interface EbayStatus {
  connected: boolean;
  message: string;
}

export function getEbayStatus(): EbayStatus {
  return {
    connected: false,
    message:
      'eBay is not connected yet. Listing drafts are generated locally — connect eBay in Settings when ready.',
  };
}

export async function publishToEbay(
  _item: Item,
  _ebayPrice: number,
): Promise<{ ok: false; message: string }> {
  return {
    ok: false,
    message:
      'eBay is not connected yet (v1 placeholder). Copy the listing draft from the Listing screen and paste it into eBay, or finish the eBay Developer setup first.',
  };
}
