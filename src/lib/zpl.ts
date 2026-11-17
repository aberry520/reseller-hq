// Zebra ZPL label generation for the Zebra thermal printer.
// Label size: 2" x 1" at 203 dpi = 406 x 203 dots (change LABEL_W_DOTS /
// LABEL_H_DOTS if Austin's label stock is a different size).
// ^BQ is the ZPL QR-code command: ^BQN,2,<magnification> then ^FDQA,<data>.
// Each label prints: QR (encodes reseller://item/RB-xxx), a short name
// (max 24 chars, no prices — see shortName), and the human-readable ID.
// The app does NOT talk to the printer directly in v1 — it generates a .zpl
// text file (one label per ^XA...^XZ block) that can be sent to the printer
// with Zebra Setup Utilities, Zebra Browser Print, or any ZPL sender.
// expo-print is the fallback: a PDF sheet of the same labels for a normal printer.

import { cleanName } from './listing';
import type { Item } from './types';

export const LABEL_W_DOTS = 406; // 2" at 203 dpi
export const LABEL_H_DOTS = 203; // 1" at 203 dpi

function zplEscape(s: string): string {
  // ZPL field data: ^ and ~ start commands, so strip them.
  return s.replace(/[\^~]/g, '').trim();
}

// Short, human-readable label name: the sheet's Item field often carries a
// MAC.BID suffix (" | Location: Anderson - LRetail: $149.00 Invoice: ... |
// $52.43 Unpaid") that is unreadable on a 2"x1" label and puts prices on it.
// Keep only the product name, strip any price/invoice text, max 24 chars
// at a word boundary. The QR holds the full identity; the phone shows the
// full name when scanned. Same logic is mirrored in web/app.js shortName.
export function shortName(raw: string): string {
  let s = cleanName(raw);
  const loc = s.search(/\|?\s*Location:/i);
  if (loc >= 0) s = s.slice(0, loc);
  s = s
    .replace(/\$\s?[\d,]+(\.\d{2})?/g, '')
    .replace(/invoice:?\s*\d+/gi, '')
    .replace(/retail:?/gi, '')
    .replace(/\b(saved|unpaid)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[|;:,]+$/g, '')
    .trim();
  if (!s) return 'Unnamed item';
  if (s.length <= 24) return s;
  const cut = s.slice(0, 24);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim();
}

// Split a short name into up to 2 ZPL text lines, each <= 18 chars.
function splitNameLines(name: string): string[] {
  if (name.length <= 18) return [name];
  const cut = name.slice(0, 18);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= 8) return [cut.slice(0, lastSpace).trim(), name.slice(lastSpace + 1, 36).trim()];
  return [cut.trim(), name.slice(18, 36).trim()];
}

export function zplForItem(item: Item, qrMagnification = 4): string {
  const name = zplEscape(shortName(item.name));
  const nameLines = splitNameLines(name);
  const lines = [
    '^XA',
    `^PW${LABEL_W_DOTS}`,
    `^LL${LABEL_H_DOTS}`,
    // QR on the left.
    `^FO10,10^BQN,2,${qrMagnification}`,
    `^FDQA,${zplEscape(item.qrCode)}^FS`,
    // Short name, up to two lines, larger type so it stays readable.
    `^FO130,20^A0N,26,26^FD${nameLines[0]}^FS`,
    ...(nameLines[1] ? [`^FO130,52^A0N,26,26^FD${nameLines[1]}^FS`] : []),
    // Human-readable ID.
    `^FO130,118^A0N,28,28^FD${zplEscape(item.id)}^FS`,
    '^PQ1',
    '^XZ',
  ];
  return lines.join('\n');
}

export function zplForItems(items: Item[]): string {
  return items.map((it) => zplForItem(it)).join('\n');
}

/**
 * Full HTML print sheet for WEB printing (2" x 1" label per page).
 * expo-print on web just calls window.print() on the current page and
 * ignores the HTML passed in, so the app opens this in a new tab and
 * prints it from there instead. Same QR + short name + ID as the ZPL,
 * one label per page (@page 2in x 1in, margins none). In the print dialog
 * pick the Zebra GC420T (2" x 1" stock, margins None, scale 100%) or
 * "Save as PDF" for a PDF copy.
 */
export function labelsPrintHtml(items: Item[]): string {
  const cards = items
    .map((it) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(it.qrCode)}`;
      return `<div class="label"><img src="${qrUrl}" /><div class="label-text"><div class="label-name">${escapeHtml(shortName(it.name))}</div><div class="label-id">${escapeHtml(it.id)}</div></div></div>`;
    })
    .join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Reseller HQ — Print labels</title><style>
@page { size: 2in 1in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.label { width: 2in; height: 1in; margin: 0; padding: 0.05in 0.06in; box-sizing: border-box; overflow: hidden; display: flex; align-items: center; gap: 0.06in; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; page-break-after: always; break-after: page; }
.label:last-child { page-break-after: auto; break-after: auto; }
.label img { width: 0.8in; height: 0.8in; flex: none; }
.label-text { min-width: 0; flex: 1; }
.label-name { font-size: 12pt; font-weight: bold; line-height: 1.15; overflow: hidden; overflow-wrap: break-word; }
.label-id { font-size: 14pt; font-weight: bold; margin-top: 0.05in; }
</style></head><body>${cards}</body></html>`;
}

/** Simple HTML for expo-print: one label card per item with a QR image. */
export function labelsHtml(items: Item[]): string {
  const cards = items
    .map((it) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(it.qrCode)}`;
      return `<div style="width:2in;height:1in;border:1px solid #000;display:inline-block;margin:4px;padding:4px;box-sizing:border-box;overflow:hidden;font-family:sans-serif;">
        <img src="${qrUrl}" style="width:0.8in;height:0.8in;float:left;margin-right:6px;" />
        <div style="font-size:12px;font-weight:bold;">${escapeHtml(shortName(it.name))}</div>
        <div style="font-size:14px;font-weight:bold;">${escapeHtml(it.id)}</div>
      </div>`;
    })
    .join('\n');
  return `<html><body>${cards}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
