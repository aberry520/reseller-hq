import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { getAllItems, getCounts } from '../src/lib/db';
import { formatMoney } from '../src/lib/pricing';
import { cleanName } from '../src/lib/listing';
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
    <View style={styles.container}>
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
      />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        ListEmptyComponent={<Text style={styles.empty}>No items match this filter.</Text>}
        renderItem={({ item }) => (
          <Link href={`/item/${item.id}`} asChild>
            <Pressable style={styles.row}>
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
      <View style={styles.footer}>
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
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chip: {
    backgroundColor: '#eaeef2',
    borderRadius: 14,
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: '#0969da' },
  chipText: { color: '#1f2328', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 8 },
  container: { backgroundColor: '#fff', flex: 1 },
  empty: { color: '#656d76', marginTop: 24, textAlign: 'center' },
  footer: {
    borderTopColor: '#d0d7de',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
  },
  footerBtn: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  footerBtnText: { color: '#fff', fontWeight: '700' },
  row: {
    alignItems: 'center',
    borderBottomColor: '#eaeef2',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowMain: { flex: 1, marginRight: 8 },
  rowMeta: { color: '#656d76', fontSize: 12, marginTop: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  search: {
    backgroundColor: '#f6f8fa',
    borderColor: '#d0d7de',
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summary: { backgroundColor: '#f6f8fa', paddingHorizontal: 12, paddingVertical: 8 },
  summaryText: { fontSize: 13, fontWeight: '600' },
});
