import { useMemo, useState } from 'react';
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
import { Link, Tabs, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteItem, getAllItems, getCounts } from '../../src/lib/db';
import { formatMoney } from '../../src/lib/pricing';
import { cleanName } from '../../src/lib/listing';
import { colors, minTouchHeight, radius, spacing } from '../../src/lib/ui';
import type { Item, ItemStatus } from '../../src/lib/types';

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
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('To List');
  // Multi-select delete: tap Select, tick the boxes, Delete removes them all.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

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
      'They will be permanently removed from Reseller HQ. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            for (const id of selected) deleteItem(id);
            setItems(getAllItems());
            setCounts(getCounts());
            exitSelectMode();
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
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={selectMode ? 'Cancel selection' : 'Select items'}
              >
                <Ionicons
                  name={selectMode ? 'close-outline' : 'checkbox-outline'}
                  size={24}
                  color={colors.text}
                />
              </Pressable>
              <Pressable
                onPress={() => router.push('/add')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Add item"
              >
                <Ionicons name="add" size={26} color={colors.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <View style={[styles.container, { paddingTop: spacing.sm }]}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {items.length} items · {toList} to list · {counts['Listed'] ?? 0} listed ·{' '}
          {counts['Sold'] ?? 0} sold
        </Text>
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search items or RB-001…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
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
              <Link href={`/item/${item.id}`} asChild>
                <Pressable style={styles.row} hitSlop={{ top: 4, bottom: 4 }}>
                  <RowContent item={item} />
                </Pressable>
              </Link>
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
            <Text style={styles.footerBtnText}>Delete ({selected.size})</Text>
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
