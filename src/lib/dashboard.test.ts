// Dashboard checks — run with `npm run test:dashboard`
// (scripts/verify-dashboard.mjs compiles this file's assertions against
// src/lib/dashboard.ts). Every number below is copied from the sheet's Home
// tab, so the app's dashboard must reproduce the sheet exactly.
//
// Two known differences from the sheet are asserted as the APP's (correct)
// values, not the sheet's:
// - Total Spent in October 2026: the sheet says $0.00 because its formula
//   only covers Purchase rows 3-139. The app counts all rows: $192.34.
// - The sheet's range is 10/1-10/31/2026; the test uses that same range.

import { computeDashboard, parseDashboardDate } from './dashboard';
import { EXPENSES_SEED_ITEMS } from './expenses-seed-data';
import { FREE_SEED_ITEMS } from './free-seed-data';
import { SEED_ITEMS } from './seed-data';
import { Item, normaliseStatus } from './types';

let failures = 0;

function check(name: string, actual: number, expected: number, tol = 0.01): void {
  const ok = Math.abs(actual - expected) < tol;
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual}, expected ${expected}`);
  if (!ok) failures += 1;
}

const items: Item[] = SEED_ITEMS.map((s) => ({
  id: s.id,
  name: s.name,
  purchase: s.purchase,
  estShip: s.estShip,
  suggestedPrice: s.suggestedPrice,
  minPrice: s.minPrice,
  researchPrice: s.researchPrice,
  notes: s.notes,
  place: s.place,
  datePurchased: s.datePurchased,
  status: normaliseStatus(s.status),
  dateListed: s.dateListed,
  dateSold: s.dateSold,
  soldPrice: s.soldPrice,
  fees: s.fees,
  shipping: s.shipping,
  profit: s.profit,
  revenue: s.revenue,
  profitMargin: s.profitMargin,
  macBidFees: s.place.toLowerCase().includes('mac'),
  location: '',
  qrCode: `reseller://item/${s.id}`,
  photos: [],
  whiteBgPhotos: [],
  createdAt: '2026-11-17T00:00:00.000Z',
}));

const start = parseDashboardDate('10/1/2026') as Date;
const end = parseDashboardDate('10/31/2026') as Date;
const d = computeDashboard(items, FREE_SEED_ITEMS, EXPENSES_SEED_ITEMS, start, end);

// Date range — All Sales (Home rows 9-15, columns B-C).
check('range all: number of sales', d.range.all.numberOfSales, 28);
check('range all: total in sales', d.range.all.totalSales, 1625.99);
check('range all: cost of sold goods', d.range.all.costOfSoldGoods, 151.01);
check('range all: fees/shipping', d.range.all.feesShipping, 407.26);
check('range all: profit', d.range.all.profit, 1067.72);
check('range all: average sale price', d.range.all.avgSalePrice, 58.07);
check('range all: average profit margin', d.range.all.avgProfitMargin, 0.5006, 0.001);

// Date range — Sourced Sales (Home rows 9-15, columns F-G).
check('range sourced: number of sales', d.range.sourced.numberOfSales, 13);
check('range sourced: total in sales', d.range.sourced.totalSales, 989.99);
check('range sourced: cost of sold goods', d.range.sourced.costOfSoldGoods, 151.01);
check('range sourced: fees/shipping', d.range.sourced.feesShipping, 376.84);
check('range sourced: profit', d.range.sourced.profit, 462.14);
check('range sourced: average sale price', d.range.sourced.avgSalePrice, 76.15);
check('range sourced: average profit margin', d.range.sourced.avgProfitMargin, 0.5006, 0.001);

// Date range — Free Sales (Home rows 9-15, columns J-K).
check('range free: number of sales', d.range.free.numberOfSales, 15);
check('range free: total in sales', d.range.free.totalSales, 636.0);
check('range free: cost of sold goods', d.range.free.costOfSoldGoods, 0);
check('range free: fees/shipping', d.range.free.feesShipping, 30.42);
check('range free: profit', d.range.free.profit, 605.58);
check('range free: average sale price', d.range.free.avgSalePrice, 42.4);
check('range free: average profit margin', d.range.free.avgProfitMargin, 0);

// All time — All Sales (Home rows 25-32, columns B-C).
check('all time all: number of sales', d.allTime.all.numberOfSales, 101);
check('all time all: total in sales', d.allTime.all.totalSales, 6896.87);
check('all time all: cost of goods', d.allTime.all.costOfGoods, 1933.77);
check('all time all: cost of sold goods', d.allTime.all.costOfSoldGoods, 710.29);
check('all time all: cost of inventory', d.allTime.all.costOfInventory, 1223.48);
check('all time all: fees/shipping', d.allTime.all.feesShipping, 1665.77);
check('all time all: profit', d.allTime.all.profit, 4530.25);
check('all time all: average sale price', d.allTime.all.avgSalePrice, 68.29);

// All time — Sourced Sales (Home rows 25-32, columns F-G).
check('all time sourced: number of sales', d.allTime.sourced.numberOfSales, 63);
check('all time sourced: total in sales', d.allTime.sourced.totalSales, 4383.88);
check('all time sourced: cost of goods', d.allTime.sourced.costOfGoods, 1933.77);
check('all time sourced: cost of sold goods', d.allTime.sourced.costOfSoldGoods, 710.29);
check('all time sourced: cost of inventory', d.allTime.sourced.costOfInventory, 1223.48);
check('all time sourced: fees/shipping', d.allTime.sourced.feesShipping, 1341.68);
check('all time sourced: profit', d.allTime.sourced.profit, 2341.35);
check('all time sourced: average sale price', d.allTime.sourced.avgSalePrice, 69.59);

// Money on Hand (Home row 37) and Total Spent in the range (Home row 5).
check('money on hand', d.moneyOnHand, 1844.2);
check('total spent in range (all rows)', d.totalSpent, 192.34);

if (failures > 0) throw new Error(`${failures} dashboard check(s) failed`);
// eslint-disable-next-line no-console
console.log('Dashboard checks done.');
