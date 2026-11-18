/**
 * eBay drafts: send items to the ebay-draft tab (eBay's own bulk draft
 * template) so they can be uploaded to eBay from Seller Hub.
 *
 * Each row is one item: Action Draft, SKU = the app ID, Category ID,
 * Title, Price = the app's suggested eBay price, Quantity 1, Condition,
 * Description, Format FixedPrice. The photo URL stays blank — the app's
 * photos are local files, so photos are added in eBay's draft editor
 * after upload.
 *
 * Category ID and Condition are set per item in the app (on the item
 * screen, or right here). An item with no Category ID cannot be sent —
 * eBay requires one — and is flagged in the list. Rows already in the
 * ebay-draft tab (same SKU) are skipped by the server, so sending the
 * same item twice does not duplicate the draft.
 *
 * After sending: open the sheet, download the ebay-draft tab as CSV, and
 * upload it in Seller Hub (Listings → Bulk upload / Reports).
 */

import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems, updateItem } from '../src/lib/db';
import { pushEbayDrafts } from '../src/lib/sync';
import { ebayDraftMissing } from '../src/lib/listing';
import { formatMoney } from '../src/lib/pricing';
import { DEFAULT_EBAY_CONDITION, EBAY_CONDITIONS } from '../src/lib/types';
import type { Item } from '../src/lib/types';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';

export default function EbayDraftsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  const reload = useCallback(() => {
    // Deleted and Sold items are never drafted; everything else is listed.
    const all = getAllItems().filter((it) => it.status !== 'Deleted' && it.status !== 'Sold');
    setItems(all);
    setSelected(
      new Set(all.filter((it) => it.status === 'Draft' || it.status === 'Unlisted').map((it) => it.id)),
    );
  }, []);

  useFocusEffect(reload);

  const chosen = useMemo(() => items.filter((it) => selected.has(it.id)), [items, selected]);
  const ready = useMemo(() => chosen.filter((it) => ebayDraftMissing(it).length === 0), [chosen]);
  const notReady = useMemo(() => chosen.filter((it) => ebayDraftMissing(it).length > 0), [chosen]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(items.map((it) => it.id)));
  const selectToList = () =>
    setSelected(
      new Set(
        items.filter((it) => it.status === 'Draft' || it.status === 'Unlisted').map((it) => it.id),
      ),
    );
  const clearSelection = () => setSelected(new Set());

  const setCategory = (id: string, value: string) => {
    const cat = value.replace(/[^0-9]/g, '');
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ebayCategoryId: cat } : it)));
  };

  const saveCategory = (id: string, value: string) => {
    updateItem(id, { ebayCategoryId: value.replace(/[^0-9]/g, '').trim() });
  };

  const cycleCondition = (id: string) => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const cur = it.ebayCondition || DEFAULT_EBAY_CONDITION;
    const idx = EBAY_CONDITIONS.indexOf(cur as (typeof EBAY_CONDITIONS)[number]);
    const next = EBAY_CONDITIONS[(idx + 1) % EBAY_CONDITIONS.length];
    updateItem(id, { ebayCondition: next });
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ebayCondition: next } : x)));
  };

  const send = () => {
    if (chosen.length === 0) {
      Alert.alert('Nothing selected', 'Pick at least one item first.');
      return;
    }
    if (ready.length === 0) {
      Alert.alert(
        'Nothing ready to send',
        'Every selected item is missing a Category ID. Set it on the item (tap a row) or in the Category box below.',
      );
      return;
    }
    const blocked = notReady.length;
    Alert.alert(
      `Send ${ready.length} item${ready.length === 1 ? '' : 's'} to eBay drafts?`,
      `They will be added to the ebay-draft tab in the sheet (Action Draft, SKU = app ID, price = suggested eBay price).${
        blocked > 0
          ? ` ${blocked} selected item${blocked === 1 ? ' is' : 's are'} missing a Category ID and will be left out.`
          : ''
      } Photos are added in eBay after upload.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setSending(true);
            setResult('');
            try {
              const res = await pushEbayDrafts(ready);
              const parts: string[] = [];
              if (res.written > 0) parts.push(`${res.written} row${res.written === 1 ? '' : 's'} added to the ebay-draft tab.`);
              if (res.skipped.length > 0)
                parts.push(`${res.skipped.length} already in the tab (skipped): ${res.skipped.join(', ')}.`);
              if (res.errors.length > 0) parts.push(`Errors: ${res.errors.join('; ')}`);
              parts.push('Next: open the sheet, download the ebay-draft tab as CSV, and upload it in Seller Hub.');
              setResult(parts.join(' '));
              reload();
            } catch (e) {
              Alert.alert('Could not send', e instanceof Error ? e.message : String(e));
            } finally {
              setSending(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.top, { paddingTop: spacing.md }]}>
        <Text style={styles.intro}>
          Sends the selected items to the ebay-draft tab. Price is the suggested eBay price; photos
          are added in eBay after upload.
        </Text>
        <View style={styles.bulkRow}>
          <Pressable style={styles.bulkBtn} onPress={selectAll}>
            <Text style={styles.bulkBtnText}>Select all</Text>
          </Pressable>
          <Pressable style={styles.bulkBtn} onPress={selectToList}>
            <Text style={styles.bulkBtnText}>Select To List</Text>
          </Pressable>
          <Pressable style={styles.bulkBtn} onPress={clearSelection}>
            <Text style={styles.bulkBtnText}>Clear</Text>
          </Pressable>
        </View>
        <Text style={styles.count}>
          {chosen.length} selected · {ready.length} ready · {notReady.length} missing a Category ID
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          const missing = ebayDraftMissing(item);
          return (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => toggle(item.id)}
                hitSlop={{ top: 4, bottom: 4 }}
              >
                <Text style={styles.check}>{on ? '☑' : '☐'}</Text>
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {item.id} · {formatMoney(item.suggestedPrice)} · {item.status}
                  </Text>
                  {missing.length > 0 && (
                    <Text style={styles.missing}>Missing: {missing.join(', ')}</Text>
                  )}
                </View>
              </Pressable>
              <View style={styles.editCol}>
                <TextInput
                  style={styles.catInput}
                  placeholder="Category ID"
                  placeholderTextColor={colors.muted}
                  value={item.ebayCategoryId ?? ''}
                  onChangeText={(v) => setCategory(item.id, v)}
                  onEndEditing={(e) => saveCategory(item.id, e.nativeEvent.text)}
                  keyboardType="number-pad"
                  returnKeyType="done"
                />
                <Pressable
                  style={styles.condBtn}
                  onPress={() => cycleCondition(item.id)}
                  hitSlop={{ top: 4, bottom: 4 }}
                >
                  <Text style={styles.condText} numberOfLines={1}>
                    {item.ebayCondition || DEFAULT_EBAY_CONDITION} ▾
                  </Text>
                </Pressable>
              </View>
              <Pressable
                style={styles.openBtn}
                onPress={() => router.push(`/item/${item.id}`)}
                hitSlop={{ top: 4, bottom: 4 }}
              >
                <Text style={styles.openBtnText}>›</Text>
              </Pressable>
            </View>
          );
        }}
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={[styles.sendBtn, (sending || chosen.length === 0) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={sending || chosen.length === 0}
        >
          <Text style={styles.sendBtnText}>
            {sending ? 'Sending…' : `Send ${ready.length} to eBay drafts`}
          </Text>
        </Pressable>
        {result !== '' && <Text style={styles.result}>{result}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bulkBtn: {
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
    minHeight: minTouchHeight,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  bulkBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  bulkRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  catInput: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    height: 40,
    paddingHorizontal: 10,
    width: 110,
  },
  check: { color: colors.text, fontSize: 20, marginRight: spacing.sm },
  condBtn: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
    width: 110,
  },
  condText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  container: { backgroundColor: colors.background, flex: 1 },
  count: { color: colors.muted, fontSize: 14, marginTop: spacing.sm },
  editCol: { gap: 6 },
  footer: { borderTopColor: colors.divider, borderTopWidth: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  missing: { color: colors.danger, fontSize: 13, marginTop: 2 },
  openBtn: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  openBtnText: { color: colors.muted, fontSize: 24 },
  result: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowMain: { alignItems: 'center', flex: 1, flexDirection: 'row', minWidth: 0 },
  rowMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowText: { flex: 1, minWidth: 0 },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingVertical: 12,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  top: { borderBottomColor: colors.divider, borderBottomWidth: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
});
