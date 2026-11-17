# Reseller HQ — Expo inventory + listing app

Local-first inventory and listing drafts for Austin's reselling business.
Runs on iPhone via **Expo Go** — no native build, no App Store step for v1.

## What it does (v1)

- **Inventory list** — all 192 items seeded from the Google Sheet Purchase tab
  (61 Sold, 57 Listed, 30 Draft, 29 unlisted, 11 Trash, 2 Return, 2 Trash Return).
  Search, filter by status, "To List" = Draft + blank (59 items).
- **Item detail** — pricing card with the real math: MAC.BID all-in cost,
  min eBay price at 30% margin, suggested eBay price, Facebook price, and a
  pass/fail check against the 30% margin target. Photos, location, status
  actions (Mark Listed / Sold / Trash / Return), QR display.
- **QR scan** — point the camera at a label to open that item.
- **Add item** — manual entry, gets the next `RB-xxx` ID automatically.
- **Listing drafts** — long eBay title (max 80 chars), short Facebook title,
  description template, eBay price + free shipping, Facebook price.
  **Drafts only — nothing is posted in v1.** Copy buttons included.
- **QR labels** — select items, save a `.zpl` file for the Zebra printer
  (2"×1", 203 dpi, `^BQ` QR code + item name + `RB-xxx`), or export a PDF
  label sheet for a normal printer. Austin's printer is a **Zebra GC420T**
  (2"×1" labels, 203 dpi, natively EPL but set up with ZPL drivers, so ZPL
  should work). If ZPL ever fails on it, use the PDF export as the fallback.
- **Settings** — background-remover URL, warehouse (Anderson), eBay fee
  (13.6%), target margin (30%), MAC.BID sales tax (7%), all persisted in SQLite.

## Pricing math

- MAC.BID all-in (Anderson): `(bid × 1.15 + $3) × 1.07`, + $10 if the lot
  must be transferred to Anderson. Example: $30 bid → **$40.13**.
- Min eBay price: `(all-in + est. ship) ÷ (1 − 0.136 − 0.30)` = `÷ 0.564`.
  Example: $40.13 + $15 ship → **$97.75**.
- Facebook price: round **up** to the nearest $5 of
  `(eBay − ship − 0.136 × eBay)`. Example: $100 eBay, $15 ship → $71.40 → **$75**.
- Note: the old sheet formulas used a 13% fee. The app uses **13.6%** per
  Austin's latest decision.

## Run on iPhone (Expo Go)

1. Install **Expo Go** from the App Store on your iPhone.
2. On your computer, in this folder:
   ```bash
   npm install
   npx expo start
   ```
3. Make sure the iPhone and computer are on the same Wi-Fi.
4. Scan the QR code in the terminal with your iPhone camera (or open Expo Go
   and scan from there). The app loads — no build step.

## Background removal (optional)

The app does not run rembg on the phone. Run the companion service on your
laptop — see [backend/README.md](backend/README.md) — then set its URL in
Settings. If it's not set, photos are kept as taken.

## Data

- Local-first: `expo-sqlite`, database `reseller.db` on the phone. Works
  offline in the garage.
- Seed: `seed-purchase.csv` (source of truth, from the Sheet) is compiled into
  `src/lib/seed-data.ts` on first run. Regenerate after a new Sheet export:
  `node scripts/generate-seed.mjs` (note: re-seeding only fills an empty DB;
  to re-import, delete the app data / reinstall Expo Go's copy).
- Google Sheets is the backup/export source, **not** a live sync in v1.

## Still placeholder / not in v1

- **eBay** — `src/services/ebay.ts` returns "not connected yet". Connecting
  it needs a human step first: join the eBay Developers Program, create a
  Production keyset + RuName, OAuth, Business Policies, inventory location.
  See the comments in that file.
- **Facebook posting** — drafts only. Posting uses the existing Facebook
  connection in Muse, not this app, for now.
- **Live Sheets sync** — the app does not read/write the Sheet live.
- **Last-minute max bid** — future feature, deliberately not in v1.
  Buying stays manual.

## Verify pricing

```bash
npm run test:pricing
```

Compiles `src/lib/pricing.ts` + `src/lib/pricing.test.ts` and runs the
worked examples ($30 bid → $40.13, $100 eBay / $15 ship → $75 FB).

## Tech stack

Expo SDK 58 (React Native + TypeScript, Expo Router), expo-sqlite,
expo-camera, expo-image-picker, expo-print, expo-file-system,
react-native-qrcode-svg. Plain React Native StyleSheet, no UI kit.
Backend: Python FastAPI + rembg (see `backend/`).
