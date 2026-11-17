import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems, getCounts, setStatus } from '../../src/lib/db';
import { pushItemsToSheetLive } from '../../src/lib/sync';
import { useOutOfSync } from '../../src/lib/useOutOfSync';
import { formatMoney } from '../../src/lib/pricing';
import { parseDashboardDate } from '../../src/lib/dashboard';
import { cleanName } from '../../src/lib/listing';
import { colors, minTouchHeight, radius, spacing } from '../../src/lib/ui';
import type { Item, ItemStatus } from '../../src/lib/types';

type Filter = 'All' | 'To List' | 'Listed' | 'Sold' | 'Draft' | 'Trash' | 'Deleted';

const FILTERS: Filter[] = ['All', 'To List', 'Listed', 'Sold', 'Draft', 'Trash', 'Deleted'];

type Sort = 'id' | 'newest' | 'oldest' | 'name' | 'costAsc' | 'costDesc' | 'priceDesc';

const SORTS: Array<{ key: Sort; label: string; short: string }> = [
  { key: 'id', label: 'ID: low to high', short: 'ID' },
  { key: 'newest', label: 'Newest first', short: 'Newest' },
  { key: 'oldest', label: 'Oldest first', short: 'Oldest' },
  { key: 'name', label: 'Name A–Z', short: 'Name A–Z' },
  { key: 'costAsc', label: 'Cost: low to high', short: 'Cost ↑' },
  { key: 'costDesc', label: 'Cost: high to low', short: 'Cost ↓' },
  { key: 'priceDesc', label: 'Suggested price: high to low', short: 'Price ↓' },
];

function sortList(list: Item[], sort: Sort): Item[] {
  const out = [...list];
  const dateVal = (it: Item) => {
    const d = parseDashboardDate(it.datePurchased);
    return d ? d.getTime() : 0;
  };
  const idNum = (it: Item) => {
    const m = it.id.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const byId = (a: Item, b: Item) => a.id.localeCompare(b.id);
  switch (sort) {
    case 'id':
      return out.sort((a, b) => idNum(a) - idNum(b) || byId(a, b));
    case 'newest':
      return out.sort((a, b) => dateVal(b) - dateVal(a) || byId(a, b));
    case 'oldest':
      return out.sort((a, b) => dateVal(a) - dateVal(b) || byId(a, b));
    case 'name':
      return out.sort(
        (a, b) =>
          cleanName(a.name).toLowerCase().localeCompare(cleanName(b.name).toLowerCase()) ||
          byId(a, b),
      );
    case 'costAsc':
      return out.sort((a, b) => a.purchase - b.purchase || byId(a, b));
    case 'costDesc':
      return out.sort((a, b) => b.purchase - a.purchase || byId(a, b));
    case 'priceDesc':
      return out.sort((a, b) => b.suggestedPrice - a.suggestedPrice || byId(a, b));
  }
}

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
  if (filter === 'Deleted') return item.status === 'Deleted';
  return item.status === filter;
}

function RowContent({ item }: { item: Item }) {
  return (
    <>
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
    </>
  );
}

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const outOfSync = useOutOfSync();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [sort, setSort] = useState<Sort>('id');
  const [sortOpen, setSortOpen] = useState(false);
  // Multi-select delete: tap Select, tick the boxes, Delete removes them all.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  // Guard against a row tap pushing the item screen more than once: a
  // second tap while a push is in flight is ignored. Cleared whenever
  // this screen regains focus (i.e. the user came back from the item).
  const navGuard = useRef(false);

  useFocusEffect(
    useCallback(() => {
      navGuard.current = false;
      setItems(getAllItems());
      setCounts(getCounts());
    }, []),
  );

  // Open an item once per tap. router.push (guarded) instead of Link:
  // the Link row was pushing the item screen several times per tap,
  // so going back took ~3 presses to reach the list again.
  const openItem = useCallback((id: string) => {
    if (navGuard.current) return;
    navGuard.current = true;
    router.push(`/item/${id}`);
  }, []);

  // Deleted items are hidden from the app (they live only in the sheet
  // until restored) — except when the filter is set to Deleted, which is
  // how Austin views and restores them. Everything below — the count,
  // the filters, the multi-select — works on the visible items only.
  const visible = useMemo(
    () =>
      filter === 'Deleted'
        ? items.filter((it) => it.status === 'Deleted')
        : items.filter((it) => it.status !== 'Deleted'),
    [items, filter],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = visible.filter(
      (it) =>
        matchesFilter(it, filter) &&
        (q === '' || cleanName(it.name).toLowerCase().includes(q) || it.id.toLowerCase() === q),
    );
    return sortList(list, sort);
  }, [visible, query, filter, sort]);

  const sortLabel = SORTS.find((s) => s.key === sort)?.short ?? 'ID';

  const toList = (counts['Draft'] ?? 0) + (counts['Unlisted'] ?? 0);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(filtered.map((it) => it.id)));
  };

  const confirmDeleteSelected = () => {
    const n = selected.size;
    if (n === 0) return;
    Alert.alert(
      `Remove ${n} item${n === 1 ? '' : 's'}?`,
      'They will be marked Deleted in the app and the sheet: hidden from the app, but kept in the sheet so they can be restored.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            for (const id of selected) setStatus(id, 'Deleted');
            setItems(getAllItems());
            setCounts(getCounts());
            exitSelectMode();
            // The Deleted status goes to the sheet right away too (and
            // pops up if offline).
            const toPush = items
              .filter((it) => selected.has(it.id))
              .map((it) => ({ ...it, status: 'Deleted' as const }));
            pushItemsToSheetLive(toPush);
          },
        },
      ],
    );
  };

  return (
    <>
      <Tabs.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => {
                  if (selectMode) exitSelectMode();
                  else {
                    setSelected(new Set());
                    setSelectMode(true);
                  }
                }}
                disabled={outOfSync || filter === 'Deleted'}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={selectMode ? 'Cancel selection' : 'Select items'}
              >
                <Ionicons
                  name={selectMode ? 'close-outline' : 'checkbox-outline'}
                  size={24}
                  color={outOfSync || filter === 'Deleted' ? colors.muted : colors.text}
                />
              </Pressable>
              <Pressable
                onPress={() => router.push('/add')}
                disabled={outOfSync}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Add item"
              >
                <Ionicons name="add" size={26} color={outOfSync ? colors.muted : colors.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <View style={[styles.container, { paddingTop: spacing.sm }]}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {visible.length} items · {toList} to list · {counts['Listed'] ?? 0} listed ·{' '}
          {counts['Sold'] ?? 0} sold
        </Text>
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search items or RHQ-000001…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <Pressable
          style={styles.filterBtn}
          onPress={() => setSortOpen(true)}
          accessibilityLabel={`Sort, currently ${sortLabel}`}
        >
          <Ionicons name="swap-vertical-outline" size={20} color={colors.text} />
          <Text style={styles.filterBtnText}>{sortLabel}</Text>
        </Pressable>
        <Pressable
          style={styles.filterBtn}
          onPress={() => setFilterOpen(true)}
          accessibilityLabel={`Filter, currently ${filter}`}
        >
          <Ionicons name="filter-outline" size={20} color={colors.text} />
          <Text style={styles.filterBtnText}>{filter}</Text>
        </Pressable>
      </View>
      <Modal
        visible={sortOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setSortOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSortOpen(false)}>
          <View style={styles.modalCard}>
            {SORTS.map((s) => (
              <Pressable
                key={s.key}
                style={styles.modalRow}
                onPress={() => {
                  setSort(s.key);
                  setSortOpen(false);
                }}
              >
                <Text style={styles.modalRowText}>{s.label}</Text>
                {sort === s.key && <Text style={styles.modalCheck}>✓</Text>}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      <Modal
        visible={filterOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setFilterOpen(false)}>
          <View style={styles.modalCard}>
            {FILTERS.map((f) => (
              <Pressable
                key={f}
                style={styles.modalRow}
                onPress={() => {
                  setFilter(f);
                  setFilterOpen(false);
                }}
              >
                <Text style={styles.modalRowText}>{f}</Text>
                {filter === f && <Text style={styles.modalCheck}>✓</Text>}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>No items match this filter.</Text>}
        renderItem={({ item }) => {
          if (selectMode) {
            const isSelected = selected.has(item.id);
            return (
              <Pressable style={styles.rowWrap} onPress={() => toggleSelect(item.id)}>
                <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <View style={styles.row}>
                  <RowContent item={item} />
                </View>
              </Pressable>
            );
          }
          return (
            <View style={styles.rowWrap}>
              <Pressable style={styles.row} hitSlop={{ top: 4, bottom: 4 }} onPress={() => openItem(item.id)}>
                <RowContent item={item} />
              </Pressable>
            </View>
          );
        }}
      />
      {selectMode && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            style={[
              styles.footerBtn,
              styles.deleteFooterBtn,
              selected.size === 0 && styles.disabledBtn,
            ]}
            disabled={selected.size === 0}
            onPress={confirmDeleteSelected}
          >
            <Text style={styles.footerBtnText}>Remove ({selected.size})</Text>
          </Pressable>
          <Pressable style={styles.footerBtn} onPress={selectAllVisible}>
            <Text style={styles.footerBtnText}>Select all</Text>
          </Pressable>
          <Pressable style={styles.footerBtn} onPress={exitSelectMode}>
            <Text style={styles.footerBtnText}>Cancel</Text>
          </Pressable>
        </View>
      )}
      </View>
    </>
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
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginRight: spacing.sm,
  },
  container: { backgroundColor: colors.background, flex: 1 },
  empty: { color: colors.muted, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  footerBtn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flexBasis: '31%',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  footerBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  listContent: { paddingBottom: spacing.md },
  row: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  rowWrap: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    marginLeft: spacing.lg,
    width: 26,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontSize: 16, fontWeight: '800' },
  deleteFooterBtn: { backgroundColor: colors.danger },
  disabledBtn: { opacity: 0.5 },
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
    flex: 1,
    fontSize: 16,
    minHeight: minTouchHeight,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 10,
    paddingHorizontal: spacing.lg,
  },
  filterBtn: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
  },
  filterBtnText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: radius.md,
    overflow: 'hidden',
    paddingVertical: spacing.xs,
  },
  modalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.lg,
  },
  modalRowText: { color: colors.text, fontSize: 17 },
  modalCheck: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  summary: { backgroundColor: colors.card, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  summaryText: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
});
