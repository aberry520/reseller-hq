// Dashboard — the app's version of the sheet's Home tab.
// Date-range sales (All / Sourced / Free), all-time sales (All / Sourced),
// Total Spent in the range, and Money on Hand. All numbers are computed
// from the app's items (the one Inventory tab; a free item is a row whose
// cost is 0) plus the Expenses list (seeded from the sheet; refreshed from
// the sheet when sync is configured).
//
// The price calculator from Home lives in Tools → Margin calculator, so it
// is not duplicated here.

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getAllItems,
  getExpenses,
  getSettings,
  replaceExpenses,
} from '../../src/lib/db';
import {
  computeDashboard,
  currentMonthRange,
  formatDashboardDate,
  parseDashboardDate,
  DashboardData,
} from '../../src/lib/dashboard';
import { fetchExpenseRows } from '../../src/lib/sync';
import { formatMoney } from '../../src/lib/pricing';
import { colors, radius, spacing } from '../../src/lib/ui';

function money(v: number): string {
  return formatMoney(v);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function StatRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, bold && styles.statValueBold]}>{value}</Text>
    </View>
  );
}

function StatCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [note, setNote] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const recompute = useCallback((startStr: string, endStr: string) => {
    const start = parseDashboardDate(startStr);
    const end = parseDashboardDate(endStr);
    if (!start || !end || end < start) return;
    setData(computeDashboard(getAllItems(), getExpenses(), start, end));
  }, []);

  const refreshFromSheet = useCallback(async () => {
    const s = getSettings();
    if (!s.syncUrl.trim() || !s.syncToken.trim()) {
      setNote('Expenses are from the saved copy — set up sheet sync to refresh them from the sheet.');
      return 'saved';
    }
    try {
      const exp = await fetchExpenseRows();
      replaceExpenses(exp);
      setNote(`Expenses refreshed from the sheet (${exp.length} expenses).`);
      return 'refreshed';
    } catch (e) {
      setNote(`Could not reach the sheet (${e instanceof Error ? e.message : 'error'}) — using the saved copy.`);
      return 'saved';
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const { start, end } = currentMonthRange();
      const startStr = formatDashboardDate(start);
      const endStr = formatDashboardDate(end);
      setStartText(startStr);
      setEndText(endStr);
      // Refresh Expenses from the sheet when configured, then show the
      // numbers (from the saved copy when offline or not configured).
      // Free items need no refresh: they are the Inventory rows whose cost
      // is 0, so they come along with the items.
      setRefreshing(true);
      refreshFromSheet()
        .finally(() => {
          recompute(startStr, endStr);
          setRefreshing(false);
        });
    }, [recompute, refreshFromSheet]),
  );

  const setRange = (start: Date, end: Date) => {
    const s = formatDashboardDate(start);
    const e = formatDashboardDate(end);
    setStartText(s);
    setEndText(e);
    recompute(s, e);
  };

  const thisMonth = () => {
    const { start, end } = currentMonthRange();
    setRange(start, end);
  };

  const lastMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    setRange(start, end);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshFromSheet();
    recompute(startText, endText);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
    >
      <Text style={styles.title}>Dashboard</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Date range</Text>
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Text style={styles.dateLabel}>Start</Text>
            <TextInput
              style={styles.input}
              value={startText}
              onChangeText={(v) => {
                setStartText(v);
                recompute(v, endText);
              }}
              placeholder="M/D/YYYY"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.dateField}>
            <Text style={styles.dateLabel}>End</Text>
            <TextInput
              style={styles.input}
              value={endText}
              onChangeText={(v) => {
                setEndText(v);
                recompute(startText, v);
              }}
              placeholder="M/D/YYYY"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        <View style={styles.chipRow}>
          <Pressable style={styles.chip} onPress={thisMonth}>
            <Text style={styles.chipText}>This month</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={lastMonth}>
            <Text style={styles.chipText}>Last month</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={onRefresh} disabled={refreshing}>
            <Text style={styles.chipText}>{refreshing ? 'Refreshing…' : 'Refresh Expenses'}</Text>
          </Pressable>
        </View>
        {!!note && <Text style={styles.note}>{note}</Text>}
      </View>

      {data && (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Money on Hand</Text>
            <Text style={styles.heroValue}>{money(data.moneyOnHand)}</Text>
            <Text style={styles.heroNote}>
              All-time profit − cost of goods − expenses · Total spent in range:{' '}
              {money(data.totalSpent)}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Sales in range</Text>
          <StatCard title="All Sales">
            <StatRow label="Number of Sales" value={String(data.range.all.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.range.all.totalSales)} />
            <StatRow label="Cost of Sold Goods" value={money(data.range.all.costOfSoldGoods)} />
            <StatRow label="Fees/Shipping" value={money(data.range.all.feesShipping)} />
            <StatRow label="Profit" value={money(data.range.all.profit)} bold />
            <StatRow label="Average sale Price" value={money(data.range.all.avgSalePrice)} />
            <StatRow
              label="Average Profit Margin (all time)"
              value={pct(data.range.all.avgProfitMargin)}
            />
          </StatCard>
          <StatCard title="Sourced Sales">
            <StatRow label="Number of Sales" value={String(data.range.sourced.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.range.sourced.totalSales)} />
            <StatRow label="Cost of Sold Goods" value={money(data.range.sourced.costOfSoldGoods)} />
            <StatRow label="Fees/Shipping" value={money(data.range.sourced.feesShipping)} />
            <StatRow label="Profit" value={money(data.range.sourced.profit)} bold />
            <StatRow label="Average sale Price" value={money(data.range.sourced.avgSalePrice)} />
            <StatRow
              label="Average Profit Margin (all time)"
              value={pct(data.range.sourced.avgProfitMargin)}
            />
          </StatCard>
          <StatCard title="Free Sales">
            <StatRow label="Number of Sales" value={String(data.range.free.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.range.free.totalSales)} />
            <StatRow label="Cost of Sold Goods" value={money(data.range.free.costOfSoldGoods)} />
            <StatRow label="Fees/Shipping" value={money(data.range.free.feesShipping)} />
            <StatRow label="Profit" value={money(data.range.free.profit)} bold />
            <StatRow label="Average sale Price" value={money(data.range.free.avgSalePrice)} />
            <StatRow label="Average Profit Margin" value={pct(data.range.free.avgProfitMargin)} />
          </StatCard>

          <Text style={styles.sectionTitle}>All Time Sales</Text>
          <StatCard title="All Sales">
            <StatRow label="Number of Sales" value={String(data.allTime.all.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.allTime.all.totalSales)} />
            <StatRow label="Cost of Goods" value={money(data.allTime.all.costOfGoods)} />
            <StatRow label="Cost of Sold Goods" value={money(data.allTime.all.costOfSoldGoods)} />
            <StatRow label="Cost of Inventory" value={money(data.allTime.all.costOfInventory)} />
            <StatRow label="Fees/Shipping" value={money(data.allTime.all.feesShipping)} />
            <StatRow label="Profit" value={money(data.allTime.all.profit)} bold />
            <StatRow label="Average sale Price" value={money(data.allTime.all.avgSalePrice)} />
          </StatCard>
          <StatCard title="Sourced Sales">
            <StatRow label="Number of Sales" value={String(data.allTime.sourced.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.allTime.sourced.totalSales)} />
            <StatRow label="Cost of Goods" value={money(data.allTime.sourced.costOfGoods)} />
            <StatRow label="Cost of Sold Goods" value={money(data.allTime.sourced.costOfSoldGoods)} />
            <StatRow label="Cost of Inventory" value={money(data.allTime.sourced.costOfInventory)} />
            <StatRow label="Fees/Shipping" value={money(data.allTime.sourced.feesShipping)} />
            <StatRow label="Profit" value={money(data.allTime.sourced.profit)} bold />
            <StatRow label="Average sale Price" value={money(data.allTime.sourced.avgSalePrice)} />
          </StatCard>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  chip: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  container: { backgroundColor: colors.background, flex: 1 },
  dateField: { flex: 1 },
  dateLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  dateRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  heroCard: {
    backgroundColor: colors.chip,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  heroLabel: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  heroNote: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  heroValue: { color: colors.text, fontSize: 32, fontWeight: '800', marginTop: 2 },
  input: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing.lg },
  statLabel: { color: colors.muted, flex: 1, fontSize: 15 },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  statValueBold: { fontWeight: '800' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
