// Dashboard — the app's version of the sheet's Home tab.
// Date-range sales (All / Sourced / Free), all-time sales (All / Sourced),
// Total Spent in the range, and Money on Hand. All numbers are computed
// from the app's items (the one Inventory tab; a free item is a row whose
// cost is 0) plus the Expenses list (seeded from the sheet; refreshed from
// the sheet when sync is configured).
//
// The price calculator from Home lives in Tools → Margin calculator, so it
// is not duplicated here.
//
// Colour: All = blue, Sourced = green, Free = amber. Profit is green when
// positive and red when negative, so the good and bad numbers read at a
// glance. Money on Hand is a tinted hero card (green when positive, red
// when negative) and shows the live expense count and total.

import { useCallback, useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getAllItems,
  getExpenses,
  getSettings,
  replaceExpenses,
} from '../../src/lib/db';
import {
  RANGE_PRESETS,
  RangePreset,
  computeDashboard,
  formatDashboardDate,
  parseDashboardDate,
  rangePreset,
  DashboardData,
} from '../../src/lib/dashboard';
import { fetchExpenseRows } from '../../src/lib/sync';
import { formatMoney } from '../../src/lib/pricing';
import DateField from '../../src/components/DateField';
import { minTouchHeight, radius, spacing } from '../../src/lib/ui';
import { useTheme, useThemedStyles } from '../../src/lib/theme-context';
import type { ThemeColors } from '../../src/lib/themes';

function money(v: number): string {
  return formatMoney(v);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

// Accent per sales group, used on the cards and the key-stat tiles.
const ACCENTS = {
  all: '#0969da',
  sourced: '#1a7f37',
  free: '#9a6700',
} as const;

type Tone = 'good' | 'bad' | undefined;

function toneOf(v: number): Tone {
  if (v > 0) return 'good';
  if (v < 0) return 'bad';
  return undefined;
}

function StatRow({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: Tone;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          bold && styles.statValueBold,
          tone === 'good' && styles.valueGood,
          tone === 'bad' && styles.valueBad,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function StatCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.card, { borderTopColor: accent, borderTopWidth: 4 }]}>
      <View style={styles.cardTitleRow}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={[styles.cardTitle, { color: accent }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

// One headline number in the key-stats grid (range sales).
function Tile({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent: string;
  tone?: Tone;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.tile, { borderTopColor: accent, borderTopWidth: 4 }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text
        style={[
          styles.tileValue,
          tone === 'good' && styles.valueGood,
          tone === 'bad' && styles.valueBad,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // The range is a preset (This month / Last month / Last 3 months / Year
  // to date) or 'custom' once the start or end date is picked by hand.
  const [preset, setPreset] = useState<RangePreset | 'custom'>('thisMonth');
  const [startDate, setStartDate] = useState<Date>(rangePreset('thisMonth').start);
  const [endDate, setEndDate] = useState<Date>(rangePreset('thisMonth').end);
  const [presetOpen, setPresetOpen] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [note, setNote] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const recompute = useCallback((start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
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
      // Deleted rows stay in the sheet so they can be restored; the count
      // shown is the live ones only.
      const live = exp.filter((e) => (e.status || '').trim() !== 'Deleted').length;
      setNote(`Expenses refreshed from the sheet (${live} expenses).`);
      return 'refreshed';
    } catch (e) {
      setNote(`Could not reach the sheet (${e instanceof Error ? e.message : 'error'}) — using the saved copy.`);
      return 'saved';
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const { start, end } = rangePreset('thisMonth');
      setPreset('thisMonth');
      // Refresh Expenses from the sheet when configured, then show the
      // numbers (from the saved copy when offline or not configured).
      // Free items need no refresh: they are the Inventory rows whose cost
      // is 0, so they come along with the items.
      setRefreshing(true);
      refreshFromSheet()
        .finally(() => {
          recompute(start, end);
          setRefreshing(false);
        });
    }, [recompute, refreshFromSheet]),
  );

  const applyPreset = (p: RangePreset) => {
    setPreset(p);
    setPresetOpen(false);
    const { start, end } = rangePreset(p);
    recompute(start, end);
  };

  // Picking a start or end date by hand makes the range custom.
  const onCustomStart = (dateStr: string) => {
    const start = parseDashboardDate(dateStr);
    if (!start || start > endDate) return;
    setPreset('custom');
    recompute(start, endDate);
  };

  const onCustomEnd = (dateStr: string) => {
    const end = parseDashboardDate(dateStr);
    if (!end || end < startDate) return;
    setPreset('custom');
    recompute(startDate, end);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshFromSheet();
    recompute(startDate, endDate);
    setRefreshing(false);
  };

  const presetLabel =
    preset === 'custom'
      ? 'Custom'
      : (RANGE_PRESETS.find((p) => p.key === preset)?.label ?? 'This month');

  const moneyTone = data ? toneOf(data.moneyOnHand) : undefined;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.titleRow}>
        <Image source={require('../../assets/icon.png')} style={styles.logoMark} />
        <Text style={styles.title}>Dashboard</Text>
      </View>

      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Pressable style={styles.dropdown} onPress={() => setPresetOpen(true)}>
            <Text style={styles.dropdownText}>{presetLabel}</Text>
            <Text style={styles.dropdownChevron}>▾</Text>
          </Pressable>
          <Pressable
            style={styles.refreshBtn}
            onPress={onRefresh}
            disabled={refreshing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Refresh expenses from the sheet"
          >
            <Ionicons name="refresh" size={22} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.customRow}>
          <View style={styles.customField}>
            <DateField label="Start" value={formatDashboardDate(startDate)} onChange={onCustomStart} />
          </View>
          <View style={styles.customField}>
            <DateField label="End" value={formatDashboardDate(endDate)} onChange={onCustomEnd} />
          </View>
        </View>
        {!!note && <Text style={styles.note}>{note}</Text>}
      </View>

      <Modal
        visible={presetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPresetOpen(false)}
      >
        <View style={styles.sheet}>
          <View style={[styles.sheetCard, { paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.sheetTitle}>Date range</Text>
            {RANGE_PRESETS.map((p) => (
              <Pressable
                key={p.key}
                style={[styles.option, preset === p.key && styles.optionActive]}
                onPress={() => applyPreset(p.key)}
              >
                <Text style={[styles.optionText, preset === p.key && styles.optionTextActive]}>
                  {p.label}
                </Text>
                {preset === p.key && <Text style={styles.optionCheck}>✓</Text>}
              </Pressable>
            ))}
            <Pressable style={styles.cancelBtn} onPress={() => setPresetOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {data && (
        <>
          <View
            style={[
              styles.heroCard,
              moneyTone === 'good' && styles.heroGood,
              moneyTone === 'bad' && styles.heroBad,
            ]}
          >
            <Text style={styles.heroLabel}>Money on Hand</Text>
            <Text
              style={[
                styles.heroValue,
                moneyTone === 'good' && styles.valueGood,
                moneyTone === 'bad' && styles.valueBad,
              ]}
            >
              {money(data.moneyOnHand)}
            </Text>
            <Text style={styles.heroNote}>
              {data.expenses.count} expense{data.expenses.count === 1 ? '' : 's'} ·{' '}
              {money(data.expenses.total)} · Total spent in range: {money(data.totalSpent)}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Sales in range</Text>
          <View style={styles.tileGrid}>
            <Tile
              label="Sales"
              value={String(data.range.all.numberOfSales)}
              accent={ACCENTS.all}
            />
            <Tile
              label="Total sales"
              value={money(data.range.all.totalSales)}
              accent={ACCENTS.all}
            />
            <Tile
              label="Profit"
              value={money(data.range.all.profit)}
              accent={ACCENTS.sourced}
              tone={toneOf(data.range.all.profit)}
            />
            <Tile
              label="Avg margin"
              value={pct(data.range.all.avgProfitMargin)}
              accent={ACCENTS.free}
              tone={toneOf(data.range.all.avgProfitMargin)}
            />
          </View>

          <StatCard title="All Sales" accent={ACCENTS.all}>
            <StatRow label="Number of Sales" value={String(data.range.all.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.range.all.totalSales)} />
            <StatRow label="Cost of Sold Goods" value={money(data.range.all.costOfSoldGoods)} />
            <StatRow label="Fees/Shipping" value={money(data.range.all.feesShipping)} />
            <StatRow
              label="Profit"
              value={money(data.range.all.profit)}
              bold
              tone={toneOf(data.range.all.profit)}
            />
            <StatRow label="Average sale Price" value={money(data.range.all.avgSalePrice)} />
            <StatRow
              label="Average Profit Margin (all time)"
              value={pct(data.range.all.avgProfitMargin)}
              tone={toneOf(data.range.all.avgProfitMargin)}
            />
          </StatCard>
          <StatCard title="Sourced Sales" accent={ACCENTS.sourced}>
            <StatRow label="Number of Sales" value={String(data.range.sourced.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.range.sourced.totalSales)} />
            <StatRow label="Cost of Sold Goods" value={money(data.range.sourced.costOfSoldGoods)} />
            <StatRow label="Fees/Shipping" value={money(data.range.sourced.feesShipping)} />
            <StatRow
              label="Profit"
              value={money(data.range.sourced.profit)}
              bold
              tone={toneOf(data.range.sourced.profit)}
            />
            <StatRow label="Average sale Price" value={money(data.range.sourced.avgSalePrice)} />
            <StatRow
              label="Average Profit Margin (all time)"
              value={pct(data.range.sourced.avgProfitMargin)}
              tone={toneOf(data.range.sourced.avgProfitMargin)}
            />
          </StatCard>
          <StatCard title="Free Sales" accent={ACCENTS.free}>
            <StatRow label="Number of Sales" value={String(data.range.free.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.range.free.totalSales)} />
            <StatRow label="Cost of Sold Goods" value={money(data.range.free.costOfSoldGoods)} />
            <StatRow label="Fees/Shipping" value={money(data.range.free.feesShipping)} />
            <StatRow
              label="Profit"
              value={money(data.range.free.profit)}
              bold
              tone={toneOf(data.range.free.profit)}
            />
            <StatRow label="Average sale Price" value={money(data.range.free.avgSalePrice)} />
            <StatRow
              label="Average Profit Margin"
              value={pct(data.range.free.avgProfitMargin)}
              tone={toneOf(data.range.free.avgProfitMargin)}
            />
          </StatCard>

          <Text style={styles.sectionTitle}>All Time Sales</Text>
          <StatCard title="All Sales" accent={ACCENTS.all}>
            <StatRow label="Number of Sales" value={String(data.allTime.all.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.allTime.all.totalSales)} />
            <StatRow label="Cost of Goods" value={money(data.allTime.all.costOfGoods)} />
            <StatRow label="Cost of Sold Goods" value={money(data.allTime.all.costOfSoldGoods)} />
            <StatRow label="Cost of Inventory" value={money(data.allTime.all.costOfInventory)} />
            <StatRow label="Fees/Shipping" value={money(data.allTime.all.feesShipping)} />
            <StatRow
              label="Profit"
              value={money(data.allTime.all.profit)}
              bold
              tone={toneOf(data.allTime.all.profit)}
            />
            <StatRow label="Average sale Price" value={money(data.allTime.all.avgSalePrice)} />
          </StatCard>
          <StatCard title="Sourced Sales" accent={ACCENTS.sourced}>
            <StatRow label="Number of Sales" value={String(data.allTime.sourced.numberOfSales)} />
            <StatRow label="Total in Sales" value={money(data.allTime.sourced.totalSales)} />
            <StatRow label="Cost of Goods" value={money(data.allTime.sourced.costOfGoods)} />
            <StatRow label="Cost of Sold Goods" value={money(data.allTime.sourced.costOfSoldGoods)} />
            <StatRow label="Cost of Inventory" value={money(data.allTime.sourced.costOfInventory)} />
            <StatRow label="Fees/Shipping" value={money(data.allTime.sourced.feesShipping)} />
            <StatRow
              label="Profit"
              value={money(data.allTime.sourced.profit)}
              bold
              tone={toneOf(data.allTime.sourced.profit)}
            />
            <StatRow label="Average sale Price" value={money(data.allTime.sourced.avgSalePrice)} />
          </StatCard>
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      marginTop: spacing.md,
      padding: spacing.md,
    },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    cardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: 4 },
    container: { backgroundColor: colors.background, flex: 1 },
    customField: { flex: 1 },
    customRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    dot: { borderRadius: 5, height: 10, width: 10 },
    dropdown: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: minTouchHeight,
      paddingHorizontal: spacing.md,
    },
    dropdownChevron: { color: colors.muted, fontSize: 16 },
    dropdownText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    heroBad: { backgroundColor: '#fdecea' },
    heroCard: {
      backgroundColor: colors.chip,
      borderRadius: radius.md,
      marginTop: spacing.md,
      padding: spacing.lg,
    },
    heroGood: { backgroundColor: '#e6f4ea' },
    heroLabel: { color: colors.muted, fontSize: 14, fontWeight: '600' },
    heroNote: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
    heroValue: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 2 },
    headerCard: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      marginTop: spacing.md,
      padding: spacing.md,
    },
    headerRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
    logoMark: { borderRadius: 8, height: 34, width: 34 },
    note: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: spacing.sm },
    option: {
      alignItems: 'center',
      borderBottomColor: colors.divider,
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: minTouchHeight,
      paddingVertical: spacing.sm,
    },
    optionActive: { backgroundColor: colors.card },
    optionCheck: { color: colors.primary, fontSize: 16, fontWeight: '700' },
    optionText: { color: colors.text, fontSize: 16 },
    optionTextActive: { color: colors.primary, fontWeight: '700' },
    refreshBtn: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      height: minTouchHeight,
      justifyContent: 'center',
      width: minTouchHeight,
    },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing.lg },
    sheet: { backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'flex-end' },
    sheetCard: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
    },
    sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
    cancelBtn: {
      alignItems: 'center',
      backgroundColor: colors.muted,
      borderRadius: radius.sm,
      marginTop: spacing.md,
      minHeight: minTouchHeight,
      paddingVertical: spacing.md,
    },
    cancelText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    statLabel: { color: colors.muted, flex: 1, fontSize: 15 },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    statValue: { color: colors.text, fontSize: 16, fontWeight: '600' },
    statValueBold: { fontWeight: '800' },
    tile: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexBasis: '48%',
      flexGrow: 1,
      padding: spacing.md,
    },
    tileGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    tileLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    tileValue: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 4 },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
    valueBad: { color: colors.danger },
    valueGood: { color: colors.success },
  });
