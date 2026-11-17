# Reseller HQ — Web label printer

Print QR labels for your inventory from your Windows PC, straight to the
Zebra GC420T you already have set up in Windows Printers & Devices.
No framework, no build step, no new npm packages — just Node, which is
already installed on the PC (v26).

## Run it

On the PC, from the repo you already cloned:

```powershell
cd $HOME\Repos\Personal\reseller-hq
git pull
cd web
node server.mjs
```

Then open **http://localhost:8080** in Chrome or Edge.

Stop it with `Ctrl+C` in that PowerShell window.

## Use it

1. **Search** by name or RB-xxx, or pick a status chip: All, To List, Draft,
   Listed, Sold, Trash (with counts on each).
2. **Bulk select** — the buttons at the top do the heavy lifting:
   - **Select all filtered** — everything matching the current search + filter
   - **Select all 192** — the whole inventory
   - **Select To List (59)** — Draft + unlisted, the pile still to list
   - **Clear selection** — start over
   - The To List pile is pre-selected when the page loads.
3. Check the **label preview** — each selected item shows a 2" × 1" card with
   QR + name + RB-xxx, the same layout as the ZPL labels in the phone app.
4. **Print selected** — opens the print dialog.
5. **Download ZPL for selected** — saves `labels.zpl` (same ZPL the phone app
   generates) if you'd rather send it to the printer with Zebra Setup
   Utilities or Browser Print.

## Print setup (important)

In the Chrome / Edge print dialog:

- **Printer:** your **Zebra GC420T**
- **Paper size:** **2" × 1"** (if the driver doesn't offer it, create it in
  Windows Settings → Printers → Printing preferences, or pick the label
  stock size your driver calls it)
- **Margins:** **None**
- **Scale:** **100%**
- Uncheck "Headers and footers" if the browser offers it

The page's print CSS hides everything except the labels, and each label is
exactly 2" × 1" with a page break after it, so one label comes out per
sticker.

**Print one test label first and scan it with the phone app** — the QR
encodes `reseller://item/RB-xxx` and should open that item. If the QR is
too small to scan, the ZPL download is the more exact path (it uses the
printer's own `^BQ` QR at magnification 4).

## Files

- `index.html` / `app.js` / `styles.css` — the page
- `items.json` — inventory (192 items), generated from `../seed-purchase.csv`
- `generate-items.mjs` — regenerates `items.json`; re-run it after the sheet
  changes: `node generate-items.mjs`
- `qrcode.min.js` — vendored QR library (qrcode-generator 1.4.4, MIT), so
  QR codes work offline; a CDN copy is the fallback if the local file is missing
- `server.mjs` — zero-dependency Node server (built-in `http` only), port 8080

## Notes / caveats

- The inventory here is a snapshot of the Google Sheet at the time
  `items.json` was generated. The phone app is the live copy — if you add or
  sell items, re-export the sheet to `seed-purchase.csv` and re-run
  `node generate-items.mjs` (and `node ../scripts/generate-seed.mjs` for the app).
- Browser printing goes through the Windows Zebra driver, so label quality
  depends on that driver being set up for 2" × 1" stock. If the driver scales
  or crops, use the ZPL download instead — raw ZPL is exact.
- The server also listens on your local network, so the page can be opened
  from the phone at `http://<pc-ip>:8080` on the same Wi-Fi, but printing
  still happens from the PC's printer.
