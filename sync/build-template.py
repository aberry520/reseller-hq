# Build the Reseller HQ sheet template (.xlsx) and the base64 copy the app
# bundles (src/lib/sheet-template-b64.ts). Run from the repo root:
#   python3 sync/build-template.py
# The .xlsx is an intermediate (it cannot be pushed as binary); the app
# bundles the base64 text, and the live Google Sheet template is the same
# structure (Inventory / Expenses / Instructions / Apps Script).
# Tab order: Instructions first, then Inventory, Expenses, Apps Script.
# The Apps Script tab holds the full sync/sheet-sync.gs code (one line per
# row in column A) so a user with no repo access can copy the whole column
# and paste it into Extensions > Apps Script.

import base64
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

OUT_XLSX = 'assets/Reseller-HQ-Template.xlsx'
OUT_B64 = 'src/lib/sheet-template-b64.ts'
SCRIPT = 'sync/sheet-sync.gs'

wb = openpyxl.Workbook()

HEADER_FILL = PatternFill('solid', fgColor='E8E8E8')
HEADER_FONT = Font(bold=True)
TITLE_FONT = Font(bold=True, size=14)
WRAP = Alignment(wrap_text=True, vertical='top')

# ---------------------------------------------------------------------------
# Instructions (first tab)
# ---------------------------------------------------------------------------
ins = wb.active
ins.title = 'Instructions'
lines = [
    ('Reseller HQ — Sheet Template', True),
    ('', False),
    ('How to use this template', True),
    ('1. Make your own copy: File > Make a copy. Do NOT edit this template directly — it is the master copy.', False),
    ('2. In your copy, delete the two example rows on the Inventory tab (rows 2–3) and the two example rows on the Expenses tab (rows 3–4), or replace them with your own items. The app will add rows for you as you add items.', False),
    ('', False),
    ('Inventory tab — do not change the structure:', True),
    ('- Row 1 is the header. Do not add rows above it, and do not rename the column headers — the app finds columns by their header text.', False),
    ('- Do not add extra columns. The app only reads the columns listed here.', False),
    ('- Suggested Price, Min Price, Profit, Revenue and Profit Mrgin are formulas — do not type in them. The app and the sync script fill them in for new rows.', False),
    ('- Ebay / Facebook / Other are checkboxes for which sites an item is listed on. The app leaves them alone.', False),
    ('- To remove an item, change its Status to Deleted (do not delete the row). It stays in the sheet as Deleted and can be restored from the app.', False),
    ('', False),
    ('Expenses tab:', True),
    ('- Row 1 is blank and row 2 is the header — leave them as they are.', False),
    ('- To remove an expense, change its Status to Deleted (do not delete the row).', False),
    ('', False),
    ('Connect the Reseller HQ app:', True),
    ('1. Open the Apps Script tab, select the whole of column A (click the "A" header), and copy it. Then Extensions > Apps Script, delete everything there, and paste. You do not need anything else — the code is in this sheet, not in a repo.', False),
    ('2. In Apps Script: Project Settings > Script Properties, add SYNC_TOKEN with a password you choose.', False),
    ('3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the web app URL.', False),
    ('4. In the app: Settings, paste the URL as the Sheet sync URL and the same SYNC_TOKEN as the token. Then open Sync and run Update app from sheet.', False),
    ('', False),
    ('That is it — the app and the sheet will stay in sync. Do not add extra rows, columns or tabs the app does not know about.', False),
]
for i, (text, is_title) in enumerate(lines, start=1):
    cell = ins.cell(row=i, column=1, value=text)
    cell.alignment = WRAP
    if is_title:
        cell.font = TITLE_FONT if i == 1 else Font(bold=True)
ins.column_dimensions['A'].width = 140

# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------
inv = wb.create_sheet('Inventory')
headers = [
    'App ID', 'Item', 'Purchase', 'Est Ship', 'Suggested Price', 'Min Price',
    'Location', 'Place of Purchase', 'Date Purchased', 'Status', 'Ebay',
    'Facebook', 'Other', 'Date Listed', 'Date Sold', 'Sold Price', 'Fees',
    'Shipping', 'Profit', 'Revenue', 'Profit Mrgin',
]
for c, h in enumerate(headers, start=1):
    cell = inv.cell(row=1, column=c, value=h)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
inv.freeze_panes = 'A2'

examples = [
    # appId, item, purchase, estShip, location, place, datePurchased, status,
    # ebay, facebook, other, dateListed, dateSold, soldPrice, fees, shipping
    ('RHQ-000001', 'Example item — replace this row', 10, 5, 'Shelf A', 'MAC.BID',
     '11/17/2026', 'Draft', '', '', '', '', '', '', '', ''),
    ('RHQ-000002', 'Example sold item — replace this row', 20, 8, 'Shelf B', 'MAC.BID',
     '11/10/2026', 'Sold', 'x', '', '', '11/12/2026', '11/15/2026', 50, 6.8, 8),
]
for i, ex in enumerate(examples):
    r = 2 + i
    inv.cell(row=r, column=1, value=ex[0])   # App ID
    inv.cell(row=r, column=2, value=ex[1])   # Item
    inv.cell(row=r, column=3, value=ex[2])   # Purchase
    inv.cell(row=r, column=4, value=ex[3])   # Est Ship
    # Suggested Price = (Purchase + Est Ship) / (1 - 0.13 - 0.30)
    inv.cell(row=r, column=5, value=f'=(C{r}+D{r})/0.57')
    # Min Price = (Purchase + Est Ship) / (1 - 0.13)
    inv.cell(row=r, column=6, value=f'=(C{r}+D{r})/0.87')
    inv.cell(row=r, column=7, value=ex[4])   # Location
    inv.cell(row=r, column=8, value=ex[5])   # Place of Purchase
    inv.cell(row=r, column=9, value=ex[6])   # Date Purchased
    inv.cell(row=r, column=10, value=ex[7])  # Status
    inv.cell(row=r, column=11, value=ex[8])  # Ebay
    inv.cell(row=r, column=12, value=ex[9])  # Facebook
    inv.cell(row=r, column=13, value=ex[10])  # Other
    inv.cell(row=r, column=14, value=ex[11])  # Date Listed
    inv.cell(row=r, column=15, value=ex[12])  # Date Sold
    inv.cell(row=r, column=16, value=ex[13] if ex[13] != '' else None)  # Sold Price
    inv.cell(row=r, column=17, value=ex[14] if ex[14] != '' else None)  # Fees
    inv.cell(row=r, column=18, value=ex[15] if ex[15] != '' else None)  # Shipping
    # Profit = IF(Sold<>"", Sold - Purchase - Fees - Shipping, "")
    inv.cell(row=r, column=19, value=f'=IF(P{r}<>"",P{r}-C{r}-Q{r}-R{r},"")')
    # Revenue = IF(Sold<>"", Sold - Fees - Shipping, "")
    inv.cell(row=r, column=20, value=f'=IF(P{r}<>"",P{r}-Q{r}-R{r},"")')
    # Profit Mrgin = IF(AND(Profit<>"",Sold<>""), Profit / Sold, "")
    inv.cell(row=r, column=21, value=f'=IF(AND(S{r}<>"",P{r}<>""),S{r}/P{r},"")')

for c in range(1, 22):
    inv.column_dimensions[get_column_letter(c)].width = 16
inv.column_dimensions['B'].width = 32
inv.column_dimensions['H'].width = 18
inv.column_dimensions['I'].width = 14
inv.column_dimensions['N'].width = 13
inv.column_dimensions['O'].width = 13

# ---------------------------------------------------------------------------
# Expenses — row 1 blank, header row 2 (matches the real sheet).
# ---------------------------------------------------------------------------
exp = wb.create_sheet('Expenses')
for c, h in enumerate(['Item', 'Price', 'Date', 'Status'], start=1):
    cell = exp.cell(row=2, column=c, value=h)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
exp.cell(row=3, column=1, value='Tape')
exp.cell(row=3, column=2, value=4)
exp.cell(row=3, column=3, value='7/1/2026')
exp.cell(row=4, column=1, value='MacBid')
exp.cell(row=4, column=2, value=29.99)
exp.cell(row=4, column=3, value='7/20/2026')
exp.freeze_panes = 'A3'
exp.column_dimensions['A'].width = 28
exp.column_dimensions['B'].width = 12
exp.column_dimensions['C'].width = 14
exp.column_dimensions['D'].width = 12

# ---------------------------------------------------------------------------
# Apps Script — the full sync endpoint code, one line per row in column A.
# ---------------------------------------------------------------------------
script = wb.create_sheet('Apps Script')
script.cell(row=1, column=1, value='// HOW TO USE: Select this whole column (click the "A" header), copy, then in your sheet go to Extensions > Apps Script, delete everything there, and paste.')
with open(SCRIPT) as f:
    code_lines = f.read().split('\n')
if code_lines and code_lines[-1] == '':
    code_lines.pop()
for i, ln in enumerate(code_lines, start=2):
    script.cell(row=i, column=1, value=ln)
script.column_dimensions['A'].width = 140

wb.save(OUT_XLSX)

# ---------------------------------------------------------------------------
# Base64 copy for the app bundle (the snapshot push cannot carry binary).
# ---------------------------------------------------------------------------
b64 = base64.b64encode(open(OUT_XLSX, 'rb').read()).decode('ascii')
chunks = [b64[i:i + 100] for i in range(0, len(b64), 100)]
with open(OUT_B64, 'w') as f:
    f.write('// The bundled sheet template (.xlsx), base64-encoded so it lives in\n')
    f.write('// the repo as text (the snapshot push cannot carry binary files).\n')
    f.write('// The Sync screen decodes this, writes a real .xlsx, and shares it.\n')
    f.write('// Regenerate with: python3 sync/build-template.py\n')
    f.write('// The same structure is also a live Google Sheet template (see the\n')
    f.write('// Instructions tab) — this is the offline, in-app copy.\n')
    f.write('export const SHEET_TEMPLATE_B64 = [\n')
    for line in chunks:
        f.write(f"  '{line}',\n")
    f.write('].join("");\n')

print('wrote', OUT_XLSX, 'and', OUT_B64)
