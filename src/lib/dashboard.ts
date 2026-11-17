// Dashboard stats — the app's version of the sheet's Home tab.
// Pure functions over the app's items (the one Inventory tab) and expenses,
// so they can be verified against the sheet's numbers
// (scripts/verify-dashboard.mjs).
//
// A "free" item is a row whose cost of goods (Purchase) is 0 — there is no
// separate Free list any more; everything lives on the one Inventory tab.
//   Sourced = cost > 0, Free = cost = 0, All = both.
//
// Definitions match the Home tab's formulas exactly, quirks included:
// - A "sale" is keyed on Sold Price, not status: the sheet counts
//   COUNTIFS(Sold Price <> ""), so an item with a sold price counts even
//   when its status is Listed or Trash Return (RB-011, RB-059).
// - Range stats use Date Sold inside the range; all-time stats use every
//   row with a sold price.
// - Cost of Sold Goods (all time) sums Purchase where Date Sold is
//   non-empty — not the same set as "sold price present" (RB-011 has a
//   sold price but no date sold, so it is excluded here).
// - Fees/Shipping (all time) sums the whole column, including the $9.44
//   sitting on unsold Purchase rows — same as the sheet's SUM.
// - Average Profit Margin in the range section is the sheet's
//   AVERAGE(Purchase[Profit Mrgin]): the all-time average over sold
//   Sourced items, not range-filtered; Free is 0, as the sheet hardcodes.
// - Money on Hand = all-time profit (all) - cost of goods - sum(expenses).
// - Total Spent (range) sums Purchase cost by Date Purchased in the range,
//   over ALL rows. The sheet's formula only covers rows 3-139, so for
//   October 2026 the sheet says $0.00 while the app (correctly) says
//   $192.34 — the October purchases sit in rows 140+.

import { roundMoney } from './pricing';
import { Expense, Item } from './types';

export interface RangeStats {
  numberOfSales: number;
  totalSales: number;
  costOfSoldGoods: number;
  feesShipping: number;
  profit: number;
  avgSalePrice: number;
  avgProfitMargin: number; // ratio, e.g. 0.5006 = 50.06%
}

export interface AllTimeStats {
  numberOfSales: number;
  totalSales: number;
  costOfGoods: number;
  costOfSoldGoods: number;
  costOfInventory: number;
  feesShipping: number;
  profit: number;
  avgSalePrice: number;
}

export interface DashboardData {
  range: { all: RangeStats; sourced: RangeStats; free: RangeStats };
  allTime: { all: AllTimeStats; sourced: AllTimeStats };
  totalSpent: number;
  moneyOnHand: number;
  // Live expenses only — Deleted rows are excluded from the count and
  // the total (they live in the sheet so they can be restored).
  expenses: { count: number; total: number };
}

// "M/d/yyyy" (or "M/d/yy") → a Date at midnight, or null when unparseable.
export function parseDashboardDate(s: string): Date | null {
  const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const d = new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  return isNaN(d.getTime()) ? null : d;
}

export function formatDashboardDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function currentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: now,
  };
}

function inRange(d: Date | null, start: Date, end: Date): boolean {
  if (!d) return false;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return day >= s && day <= e;
}

function sum(nums: number[]): number {
  return roundMoney(nums.reduce((a, b) => a + b, 0));
}

function purchaseProfit(it: Item): number {
  return roundMoney(it.soldPrice - it.purchase - it.fees - it.shipping);
}

function rangeStatsFor(
  sales: Array<{ soldPrice: number; purchase: number; fees: number; shipping: number }>,
  avgMarginAllTime: number,
): RangeStats {
  const totalSales = sum(sales.map((s) => s.soldPrice));
  const costOfSoldGoods = sum(sales.map((s) => s.purchase));
  const feesShipping = sum(sales.map((s) => s.fees + s.shipping));
  const profit = sum(sales.map((s) => s.soldPrice - s.purchase - s.fees - s.shipping));
  return {
    numberOfSales: sales.length,
    totalSales,
    costOfSoldGoods,
    feesShipping,
    profit,
    avgSalePrice: sales.length > 0 ? roundMoney(totalSales / sales.length) : 0,
    avgProfitMargin: avgMarginAllTime,
  };
}

export function computeDashboard(
  items: Item[],
  expenses: Expense[],
  start: Date,
  end: Date,
): DashboardData {
  // Deleted is history only (kept in the sheet so a delete can be undone).
  // Nothing on the dashboard counts a Deleted item — not sales, not costs,
  // not profit, not Total Spent, not Money on Hand. Filter once, up front,
  // so every stat below is live-only.
  const liveItems = items.filter((it) => (it.status || '').trim() !== 'Deleted');
  // Free = cost of goods is 0; Sourced = cost > 0.
  const sourcedItems = liveItems.filter((it) => it.purchase > 0);
  const freeItems = liveItems.filter((it) => it.purchase === 0);
  // Deleted expenses do not count toward spending.
  const liveExpenses = expenses.filter((e) => (e.status || '').trim() !== 'Deleted');
  // Sold = a sold price is recorded. Date Sold decides the range.
  const soldSourced = sourcedItems.filter((it) => it.soldPrice > 0);
  const soldFree = freeItems.filter((it) => it.soldPrice > 0);

  const rangeSourced = soldSourced.filter((it) =>
    inRange(parseDashboardDate(it.dateSold), start, end),
  );
  const rangeFree = soldFree.filter((it) =>
    inRange(parseDashboardDate(it.dateSold), start, end),
  );

  // The sheet's Average Profit Margin: all-time average over sold Sourced
  // items (not range-filtered). Free is 0, as the sheet hardcodes it.
  const margins = soldSourced.map((it) =>
    it.soldPrice > 0 ? purchaseProfit(it) / it.soldPrice : 0,
  );
  const avgMarginAllTime =
    margins.length > 0
      ? margins.reduce((a, b) => a + b, 0) / margins.length
      : 0;

  const sourced: RangeStats = rangeStatsFor(
    rangeSourced.map((it) => ({
      soldPrice: it.soldPrice,
      purchase: it.purchase,
      fees: it.fees,
      shipping: it.shipping,
    })),
    avgMarginAllTime,
  );
  const free: RangeStats = rangeStatsFor(
    rangeFree.map((it) => ({
      soldPrice: it.soldPrice,
      purchase: 0,
      fees: it.fees,
      shipping: it.shipping,
    })),
    0,
  );
  const all: RangeStats = {
    numberOfSales: sourced.numberOfSales + free.numberOfSales,
    totalSales: roundMoney(sourced.totalSales + free.totalSales),
    costOfSoldGoods: sourced.costOfSoldGoods,
    feesShipping: roundMoney(sourced.feesShipping + free.feesShipping),
    profit: roundMoney(sourced.profit + free.profit),
    avgSalePrice:
      sourced.numberOfSales + free.numberOfSales > 0
        ? roundMoney((sourced.totalSales + free.totalSales) / (sourced.numberOfSales + free.numberOfSales))
        : 0,
    avgProfitMargin: avgMarginAllTime,
  };

  // All time.
  const costOfGoods = sum(liveItems.map((it) => it.purchase));
  const costOfSoldGoods = sum(
    liveItems.filter((it) => it.dateSold.trim() !== '').map((it) => it.purchase),
  );
  const feesShippingAll = sum(liveItems.map((it) => it.fees + it.shipping));
  const feesShippingSourced = sum(sourcedItems.map((it) => it.fees + it.shipping));
  const profitSourced = sum(soldSourced.map((it) => purchaseProfit(it)));
  const profitFree = sum(soldFree.map((it) => purchaseProfit(it)));

  const allTimeSourced: AllTimeStats = {
    numberOfSales: soldSourced.length,
    totalSales: sum(soldSourced.map((it) => it.soldPrice)),
    costOfGoods,
    costOfSoldGoods,
    costOfInventory: roundMoney(costOfGoods - costOfSoldGoods),
    feesShipping: feesShippingSourced,
    profit: profitSourced,
    avgSalePrice:
      soldSourced.length > 0
        ? roundMoney(sum(soldSourced.map((it) => it.soldPrice)) / soldSourced.length)
        : 0,
  };
  const allTimeAll: AllTimeStats = {
    numberOfSales: soldSourced.length + soldFree.length,
    totalSales: roundMoney(allTimeSourced.totalSales + sum(soldFree.map((it) => it.soldPrice))),
    costOfGoods,
    costOfSoldGoods,
    costOfInventory: allTimeSourced.costOfInventory,
    feesShipping: feesShippingAll,
    profit: roundMoney(profitSourced + profitFree),
    avgSalePrice:
      soldSourced.length + soldFree.length > 0
        ? roundMoney(
            (allTimeSourced.totalSales + sum(soldFree.map((it) => it.soldPrice))) /
              (soldSourced.length + soldFree.length),
          )
        : 0,
  };

  // Total Spent in the range: Purchase cost by Date Purchased.
  const totalSpent = sum(
    liveItems
      .filter((it) => inRange(parseDashboardDate(it.datePurchased), start, end))
      .map((it) => it.purchase),
  );

  const moneyOnHand = roundMoney(
    allTimeAll.profit - costOfGoods - sum(liveExpenses.map((e) => e.price)),
  );

  return {
    range: { all, sourced, free },
    allTime: { all: allTimeAll, sourced: allTimeSourced },
    totalSpent,
    moneyOnHand,
    expenses: {
      count: liveExpenses.length,
      total: sum(liveExpenses.map((e) => e.price)),
    },
  };
}
