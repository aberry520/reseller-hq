import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems, getCounts } from '../src/lib/db';
import { formatMoney } from '../src/lib/pricing';
import { cleanName } from '../src/lib/listing';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';
import type { Item, ItemStatus } from '../src/lib/types';

type Filter = 'All' | 'To List' | 'Listed' | 'Sold' | 'Draft' | 'Trash';

const FILTERS: Filter[] = ['All', 'To List', 'Listed', 'Sold', 'Draft', 'Trash'];

const BADGE_COLORS: Record<string, string> = {
  Sold: '#1a7f37',
  Listed: '#0969da',
  Draft: '#9a6700',
  Unlisted: '#cf222e',
  Trash: '#656d76',
  Return: '#8250df',
  'Trash Return': '#8250df',
};

function matchesFilter(item: Item, filter: Filter): boolean {
  if (filter === 'All') return true;
  if (filter === 'To List') return item.status === 'Draft' || item.status === 'Unlisted';
  if (filter === 'Trash') return item.status === 'Trash' || item.status === 'Trash Return';
  return item.status === filter;
}

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('To List');

  useFocusEffect(
    useCallback(() => {
      setItems(getAllItems());
      setCounts(getCounts());
    }, []),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (it) =>
        matchesFilter(it, filter) &&
        (q === '' || cleanName(it.name).toLowerCase().includes(q) || it.id.toLowerCase() === q),
    );
  }, [items, query, filter]);

  const toList = (counts['Draft'] ?? 0) + (counts['Unlisted'] ?? 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {items.length} items · {toList} to list · {counts['Listed'] ?? 0} listed ·{' '}
          {counts['Sold'] ?? 0} sold
        </Text>
      </View>
      <TextInput
        style={styles.search}
        placeholder="Search items or RB-001…"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>No items match this filter.</Text>}
        renderItem={({ item }) => (
          <Link href={`/item/${item.id}`} asChild>
            <Pressable style={styles.row} hitSlop={{ top: 4, bottom: 4 }}>
              {item.photos.length > 0 ? (
                <Image source={{ uri: item.photos[0] }} style={styles.thumb} />
              ) : (
                <View style={styles.thumbPlaceholder}>
                  <Text style={styles.thumbPlaceholderText}>No{'\n'}photo</Text>
                </View>
              )}
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {cleanName(item.name)}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.id} · bought {formatMoney(item.purchase)}
                  {item.suggestedPrice > 0 ? ` · suggested ${formatMoney(item.suggestedPrice)}` : ''}
                  {item.place ? ` · ${item.place}` : ''}
                </Text>
              </View>
              <Text
                style={[
                  styles.badge,
                  { backgroundColor: BADGE_COLORS[item.status] ?? '#656d76' },
                ]}
              >
                {item.status}
              </Text>
            </Pressable>
          </Link>
        )}
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Link href="/scan" asChild>
          <Pressable style={styles.footerBtn}>
            <Text style={styles.footerBtnText}>Scan QR</Text>
          </Pressable>
        </Link>
        <Link href="/add" asChild>
          <Pressable style={styles.footerBtn}>
            <Text style={styles.footerBtnText}>+ Add item</Text>
          </Pressable>
        </Link>
        <Link href="/labels" asChild>
          <Pressable style={styles.footerBtn}>
            <Text style={styles.footerBtnText}>Labels</Text>
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable style={styles.footerBtn}>
            <Text style={styles.footerBtnText}>Settings</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 10,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: 22,
    justifyContent: 'center',
    marginBottom: 6,
    marginRight: 6,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  container: { backgroundColor: colors.background, flex: 1 },
  empty: { color: colors.muted, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  footerBtn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  footerBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  listContent: { paddingBottom: spacing.md },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowMeta: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  thumb: { borderRadius: radius.sm, height: 64, marginRight: spacing.sm, width: 64 },
  thumbPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
    height: 64,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 64,
  },
  thumbPlaceholderText: { color: colors.muted, fontSize: 11, lineHeight: 14, textAlign: 'center' },
  rowName: { color: colors.text, fontSize: 17, fontWeight: '600', lineHeight: 22 },
  search: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    fontSize: 16,
    marginHorizontal: spacing.lg,
    marginTop: 10,
    minHeight: minTouchHeight,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  summary: { backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  summaryText: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
});
