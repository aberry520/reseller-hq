# Printer — Austin's Zebra

- Model: Zebra GC420T (older model)
- Label size: 2" x 1"
- Native language: EPL, but set up with ZPL drivers — ZPL should work
- App already generates ZPL for 2" x 1" at 203 dpi (406 x 203 dots), ^BQ QR magnification 4, QR on left, name + ID on right. See src/lib/zpl.ts
- Test one label first and scan it before a batch. If ZPL fails on the GC420T, fall back to the PDF label sheet (expo-print) or EPL.
