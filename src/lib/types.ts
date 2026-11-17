// Data model for Reseller HQ.
// Source columns come from the Google Sheet "Purchase" tab (see seed-purchase.csv).
// Status values in the sheet: Sold, Listed, Draft, Trash, Return, Trash Return,
// blank (= not listed yet). The app normalises blank to "Unlisted" for display.

export type SheetStatus =
  | 'Sold'
  | 'Listed'
  | 'Draft'
  | 'Trash'
  | 'Return'
  | 'Trash Return'
  | '';

export type ItemStatus =
  | 'Sold'
  | 'Listed'
  | 'Draft'
  | 'Unlisted'
  | 'Trash'
  | 'Return'
  | 'Trash Return';

export interface SeedItem {
  id: string; // RB-001, RB-002, ... in seed order — stable, used in QR codes
  name: string;
  purchase: number;
  estShip: number;
  suggestedPrice: number;
  minPrice: number;
  researchPrice: number;
  notes: string;
  place: string;
  datePurchased: string;
  status: string; // raw sheet status, '' means unlisted
  dateListed: string;
  dateSold: string;
  soldPrice: number;
  fees: number;
  shipping: number;
  profit: number;
  revenue: number;
  profitMargin: string;
}

export interface Item {
  id: string;
  name: string;
  purchase: number;
  estShip: number;
  suggestedPrice: number;
  minPrice: number;
  researchPrice: number;
  notes: string;
  place: string;
  datePurchased: string;
  status: ItemStatus;
  dateListed: string;
  dateSold: string;
  soldPrice: number;
  fees: number;
  shipping: number;
  profit: number;
  revenue: number;
  profitMargin: string;
  // App-only fields
  location: string;
  qrCode: string; // reseller://item/RB-xxx
  photos: string[]; // local URIs
  whiteBgPhotos: string[]; // local URIs after background removal
  createdAt: string;
}

export interface Settings {
  bgRemoverUrl: string;
  warehouse: string;
  ebayFeePct: number; // 0.136
  targetMarginPct: number; // 0.30
  salesTaxPct: number; // 0.07 for Anderson, SC
  // When true, a MAC.BID lot's cost is computed from the bid:
  // (bid x 1.15 + $3) x 1.07. When false, the Cost entered on the item is
  // used as-is — the total cost of goods, with no fees or tax added.
  applyMacBidFees: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  bgRemoverUrl: '',
  warehouse: 'Anderson',
  ebayFeePct: 0.136,
  targetMarginPct: 0.3,
  salesTaxPct: 0.07,
  applyMacBidFees: true,
};

export function normaliseStatus(raw: string): ItemStatus {
  const s = (raw || '').trim();
  if (s === '') return 'Unlisted';
  if (s === 'Trash Return') return 'Trash Return';
  if (s === 'Sold' || s === 'Listed' || s === 'Draft' || s === 'Trash' || s === 'Return') {
    return s;
  }
  return 'Unlisted';
}

export function qrFor(id: string): string {
  return `reseller://item/${id}`;
}

export function idFromQr(data: string): string | null {
  const m = data.trim().match(/reseller:\/\/item\/(RB-\d+)/i);
  if (m) return m[1].toUpperCase();
  // Also accept a bare ID printed under the QR.
  if (/^RB-\d+$/i.test(data.trim())) return data.trim().toUpperCase();
  return null;
}
