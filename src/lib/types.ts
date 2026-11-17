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
  // Per-item: apply the MAC.BID fees + tax to the bid when computing the
  // cost, i.e. (bid x 1.15 + $3) x 1.07. When false (or unset on old items,
  // which fall back to the place), the Cost entered is the total cost of
  // goods, with no fees or tax added. Not everything comes from MAC.BID.
  macBidFees?: boolean;
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
  syncUrl: string; // Google Apps Script web app URL for sheet sync (blank = off)
  syncToken: string; // SYNC_TOKEN script property — the sync password
}

export const DEFAULT_SETTINGS: Settings = {
  bgRemoverUrl: '',
  warehouse: 'Anderson',
  ebayFeePct: 0.136,
  targetMarginPct: 0.3,
  salesTaxPct: 0.07,
  syncUrl: '',
  syncToken: '',
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

export function appliesMacBidFees(item: Pick<Item, 'place' | 'macBidFees'>): boolean {
  if (typeof item.macBidFees === 'boolean') return item.macBidFees;
  return item.place.toLowerCase().includes('mac');
}

export function qrFor(id: string): string {
  return `reseller://item/${id}`;
}

// Free inventory (the sheet's Free tab): items Austin got for free, mostly
// Department 56 buildings. No purchase cost — profit = sold - fees - shipping.
export type FreeStatus = 'Draft' | 'Listed' | 'Sold' | 'Trash' | 'Return';

export interface FreeItem {
  id: string; // FR-xxx, by Free-tab row order
  name: string;
  box: string; // storage box (A, B, ...)
  recPrice: number;
  status: FreeStatus;
  dateListed: string;
  dateSold: string;
  soldPrice: number;
  fees: number;
  shipping: number;
}

// Business expenses (the sheet's Expenses tab).
export interface Expense {
  id: string; // EX-xxx
  name: string;
  price: number;
  date: string;
  status: string;
}

export function normaliseFreeStatus(raw: string): FreeStatus {
  const s = (raw || '').trim();
  if (s === 'Sold' || s === 'Listed' || s === 'Trash' || s === 'Return') return s;
  return 'Draft';
}

export function idFromQr(data: string): string | null {
  const m = data.trim().match(/reseller:\/\/item\/(RB-\d+)/i);
  if (m) return m[1].toUpperCase();
  // Also accept a bare ID printed under the QR.
  if (/^RB-\d+$/i.test(data.trim())) return data.trim().toUpperCase();
  return null;
}
