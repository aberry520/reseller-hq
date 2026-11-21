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
import { qrFor } from './types';

export const LABEL_W_DOTS = 406; // 2" at 203 dpi
export const LABEL_H_DOTS = 203; // 1" at 203 dpi

// Label font sizes (the ^A0 height/width in dots), picked on the labels
// screen and remembered in Settings. The name's line splitting adapts
// to the size, so a bigger font wraps to the second line sooner instead
// of running off the right edge of the label — that overflow is what
// used to cut names off.
export const LABEL_FONT_SIZES = [
  { key: 'small', label: 'Small', size: 22 },
  { key: 'medium', label: 'Medium', size: 26 },
  { key: 'large', label: 'Large', size: 32 },
] as const;
export const DEFAULT_LABEL_FONT_SIZE = 26;

// The text column starts right of the QR code and runs to the label's
// right edge (minus a small margin).
const TEXT_X = 130;
const TEXT_W_DOTS = LABEL_W_DOTS - TEXT_X - 6;

// How many characters of font 0 fit on one line at a given size. Font
// 0's average character advance is roughly 0.65 × the ^A size, so a
// bigger font fits fewer characters per line.
function charsPerLine(fontSize: number): number {
  return Math.max(10, Math.floor(TEXT_W_DOTS / (fontSize * 0.65)));
}

// The matching size for the HTML/PDF labels (points for the name; the
// ID runs 2pt larger), scaled from the ZPL size so all three outputs
// look alike.
function htmlFontPt(fontSize: number): number {
  return Math.round((fontSize * 12) / DEFAULT_LABEL_FONT_SIZE);
}

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

// Split a short name into up to 2 ZPL text lines that fit the text
// column at the chosen font size (see charsPerLine).
function splitNameLines(name: string, perLine: number): string[] {
  if (name.length <= perLine) return [name];
  const cut = name.slice(0, perLine);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= 8) return [cut.slice(0, lastSpace).trim(), name.slice(lastSpace + 1, perLine * 2).trim()];
  return [cut.trim(), name.slice(perLine, perLine * 2).trim()];
}

export function zplForItem(item: Item, fontSize = DEFAULT_LABEL_FONT_SIZE, qrMagnification = 4): string {
  const name = zplEscape(shortName(item.name));
  const nameLines = splitNameLines(name, charsPerLine(fontSize));
  const lines = [
    '^XA',
    `^PW${LABEL_W_DOTS}`,
    `^LL${LABEL_H_DOTS}`,
    // QR on the left. Derived from the ID, never from the stored qrCode
    // (a stored code can go stale when an ID changes).
    `^FO10,10^BQN,2,${qrMagnification}`,
    `^FDQA,${zplEscape(qrFor(item.id))}^FS`,
    // Short name, up to two lines, at the chosen font size.
    `^FO${TEXT_X},20^A0N,${fontSize},${fontSize}^FD${nameLines[0]}^FS`,
    ...(nameLines[1] ? [`^FO${TEXT_X},${20 + fontSize + 6}^A0N,${fontSize},${fontSize}^FD${nameLines[1]}^FS`] : []),
    // Human-readable ID, a touch larger than the name.
    `^FO${TEXT_X},118^A0N,${fontSize + 2},${fontSize + 2}^FD${zplEscape(item.id)}^FS`,
    '^PQ1',
    '^XZ',
  ];
  return lines.join('\n');
}

export function zplForItems(items: Item[], fontSize = DEFAULT_LABEL_FONT_SIZE): string {
  return items.map((it) => zplForItem(it, fontSize)).join('\n');
}

/**
 * Print fragment for WEB printing (2" x 1" label per page). expo-print on
 * web just calls window.print() on the current page and ignores the HTML
 * passed in, so the app injects this into a hidden div on the current page
 * and calls window.print() — the browser's own print dialog opens, no new
 * tab. The injected <style> hides everything else while printing. Same QR
 * + short name + ID as the ZPL, one label per page (@page 2in x 1in,
 * margins none). In the print dialog pick the Zebra GC420T (2" x 1" stock,
 * margins None, scale 100%) or "Save as PDF" for a PDF copy.
 */
export function labelsPrintFragment(items: Item[], fontSize = DEFAULT_LABEL_FONT_SIZE): string {
  const namePt = htmlFontPt(fontSize);
  const cards = items
    .map((it) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrFor(it.id))}`;
      return `<div class="label"><img src="${qrUrl}" /><div class="label-text"><div class="label-name">${escapeHtml(shortName(it.name))}</div><div class="label-id">${escapeHtml(it.id)}</div></div></div>`;
    })
    .join('\n');
  return `<style>
@page { size: 2in 1in; margin: 0; }
#reseller-print-root { display: none; }
@media print {
  body > *:not(#reseller-print-root) { display: none !important; }
  #reseller-print-root { display: block !important; margin: 0; padding: 0; background: #fff; }
}
.label { width: 2in; height: 1in; margin: 0; padding: 0.05in 0.06in; box-sizing: border-box; overflow: hidden; display: flex; align-items: center; gap: 0.06in; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; page-break-after: always; break-after: page; }
.label:last-child { page-break-after: auto; break-after: auto; }
.label img { width: 0.8in; height: 0.8in; flex: none; }
.label-text { min-width: 0; flex: 1; }
.label-name { font-size: ${namePt}pt; font-weight: bold; line-height: 1.15; overflow: hidden; overflow-wrap: break-word; }
.label-id { font-size: ${namePt + 2}pt; font-weight: bold; margin-top: 0.05in; }
</style>${cards}`;
}

/** Simple HTML for expo-print: one label card per item with a QR image. */
export function labelsHtml(items: Item[], fontSize = DEFAULT_LABEL_FONT_SIZE): string {
  const namePx = htmlFontPt(fontSize);
  const cards = items
    .map((it) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrFor(it.id))}`;
      return `<div style="width:2in;height:1in;border:1px solid #000;display:inline-block;margin:4px;padding:4px;box-sizing:border-box;overflow:hidden;font-family:sans-serif;">
        <img src="${qrUrl}" style="width:0.8in;height:0.8in;float:left;margin-right:6px;" />
        <div style="font-size:${namePx}px;font-weight:bold;">${escapeHtml(shortName(it.name))}</div>
        <div style="font-size:${namePx + 2}px;font-weight:bold;">${escapeHtml(it.id)}</div>
      </div>`;
    })
    .join('\n');
  return `<html><body>${cards}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
