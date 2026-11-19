// Listing draft generation — text only, no posting in v1.
// eBay title: SEO-style, up to 80 characters (eBay's title limit).
// Facebook title: short, human-readable, no keyword stuffing.
// MAC.BID item names in the sheet often carry extra lines:
//   "Name\nLocation: Anderson - LRetail: $123.45Invoice: 12345678\n\n$4.44Unpaid"
// cleanName() keeps the product name and drops the location/retail/invoice tail.

import type { Item } from './types';

export function cleanName(raw: string): string {
  const firstLine = (raw || '').split('\n')[0].trim();
  return firstLine.replace(/\s+/g, ' ').trim();
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Long eBay title, max 80 chars. Pass extra keywords (brand, model, size) when known. */
export function ebayTitle(item: Item, extraKeywords: string[] = []): string {
  const base = cleanName(item.name);
  const parts = [base, ...extraKeywords.filter(Boolean)];
  return truncateAtWord(parts.join(' ').replace(/\s+/g, ' ').trim(), 80);
}

/** Short Facebook title — the product name, trimmed to ~50 chars. */
export function facebookTitle(item: Item): string {
  return truncateAtWord(cleanName(item.name), 50);
}

export function listingDescription(item: Item, opts: { condition?: string } = {}): string {
  const condition = opts.condition ?? 'Used - Good';
  const lines: string[] = [];
  lines.push(cleanName(item.name));
  lines.push('');
  lines.push(`Condition: ${condition}`);
  if (item.place) lines.push(`Source: ${item.place}`);
  lines.push('');
  lines.push('What you get:');
  lines.push(`- ${cleanName(item.name)}`);
  lines.push('- See photos for exact condition and what is included.');
  if (item.notes) {
    lines.push('');
    lines.push(`Notes: ${item.notes}`);
  }
  lines.push('');
  lines.push('Ships fast with tracking. Local pickup available in the Anderson, SC area.');
  lines.push('Please check photos carefully — items from liquidation auctions are sold as described.');
  return lines.join('\n');
}

/** Copy-ready eBay draft text (title + price + description). */
export function ebayDraftText(item: Item, ebayPrice: number): string {
  return [
    `TITLE (${ebayTitle(item).length}/80 chars): ${ebayTitle(item)}`,
    `PRICE: $${ebayPrice.toFixed(2)} + FREE shipping`,
    '',
    listingDescription(item),
  ].join('\n');
}

/** Copy-ready Facebook Marketplace draft text. */
export function facebookDraftText(item: Item, fbPrice: number): string {
  return [
    `TITLE: ${facebookTitle(item)}`,
    `PRICE: $${fbPrice.toFixed(0)} (local pickup)`,
    '',
    listingDescription(item),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// eBay bulk draft rows — one row per item for the ebay-draft tab, which is
// eBay's own bulk draft template (eBay-draft-listings-template_US). Header
// is row 5, data from row 6; rows 1-4 are #INFO comments. Column order
// must match the template exactly:
//   Action | Custom label (SKU) | Category ID | Title | UPC | Price |
//   Quantity | Item photo URL | Condition ID | Description | Format
// Photo URL stays blank — the app's photos are local files, not public
// URLs, so photos are added in eBay's draft editor after upload.
// ---------------------------------------------------------------------------

/** One ebay-draft row for an item. Price is the app's suggested eBay price. */
export function ebayDraftRow(item: Item): string[] {
  return [
    'Draft',
    item.id,
    item.ebayCategoryId || '',
    ebayTitle(item),
    '',
    item.suggestedPrice > 0 ? item.suggestedPrice.toFixed(2) : '',
    '1',
    '',
    item.ebayCondition || 'Used - Good',
    listingDescription(item, { condition: item.ebayCondition || 'Used - Good' }),
    'FixedPrice',
  ];
}

/** What is missing before an item can go into an eBay draft row. */
export function ebayDraftMissing(item: Item): string[] {
  const missing: string[] = [];
  if (!item.ebayCategoryId.trim()) missing.push('Category ID');
  if (!(item.suggestedPrice > 0)) missing.push('Price');
  return missing;
}

// Drive's `uc?export=download` URL forces a file download, so it will not
// render in an <img> / React Native Image. `export=view` serves the same
// file inline. Rewrite any stored download URL to the view URL, so photos
// uploaded before that fix still display.
export function driveViewUrl(url: string): string {
  return url.replace('drive.google.com/uc?export=download&id=', 'drive.google.com/uc?export=view&id=');
}

// Best URI for the photo at index i: prefer a local file (white-bg, then
// original), fall back to the Drive URL when there is no local file (web,
// or a hosted-only photo). A Drive URL that fails to load must not hide a
// local photo that is right here.
export function photoUriAt(item: Item, index: number): string {
  const wb = item.whiteBgPhotos?.[index] ?? '';
  const local = item.photos?.[index] ?? '';
  const hosted = driveViewUrl(item.photoUrls?.[index] ?? '');
  return wb || local || hosted || '';
}

/** The item's cover photo (first photo) — same resolution as photoUriAt. */
export function coverPhotoUri(item: Item): string {
  return photoUriAt(item, 0);
}
