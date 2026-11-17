// Zebra ZPL label generation for the Zebra thermal printer.
// Label size: 2" x 1" at 203 dpi = 406 x 203 dots (change LABEL_W_DOTS /
// LABEL_H_DOTS if Austin's label stock is a different size).
// ^BQ is the ZPL QR-code command: ^BQN,2,<magnification> then ^FDQA,<data>.
// Each label prints: QR (encodes reseller://item/RB-xxx), the item name
// (truncated to fit), and the human-readable ID underneath.
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

export function zplForItem(item: Item, qrMagnification = 4): string {
  const name = zplEscape(cleanName(item.name)).slice(0, 34);
  const lines = [
    '^XA',
    `^PW${LABEL_W_DOTS}`,
    `^LL${LABEL_H_DOTS}`,
    // QR on the left.
    `^FO10,10^BQN,2,${qrMagnification}`,
    `^FDQA,${zplEscape(item.qrCode)}^FS`,
    // Item name, wrapped over two lines if needed.
    `^FO130,20^A0N,22,22^FD${name.slice(0, 22)}^FS`,
    ...(name.length > 22 ? [`^FO130,48^A0N,22,22^FD${name.slice(22)}^FS`] : []),
    // Human-readable ID.
    `^FO130,110^A0N,28,28^FD${zplEscape(item.id)}^FS`,
    `^FO130,150^A0N,18,18^FDScan to open in Reseller HQ^FS`,
    '^PQ1',
    '^XZ',
  ];
  return lines.join('\n');
}

export function zplForItems(items: Item[]): string {
  return items.map((it) => zplForItem(it)).join('\n');
}

/** Simple HTML for expo-print: one label card per item with a QR image. */
export function labelsHtml(items: Item[]): string {
  const cards = items
    .map((it) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(it.qrCode)}`;
      return `<div style="width:2in;height:1in;border:1px solid #000;display:inline-block;margin:4px;padding:4px;box-sizing:border-box;overflow:hidden;font-family:sans-serif;">
        <img src="${qrUrl}" style="width:0.8in;height:0.8in;float:left;margin-right:6px;" />
        <div style="font-size:11px;font-weight:bold;">${escapeHtml(cleanName(it.name))}</div>
        <div style="font-size:13px;">${escapeHtml(it.id)}</div>
      </div>`;
    })
    .join('\n');
  return `<html><body>${cards}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
