import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems } from '../src/lib/db';
import { cleanName } from '../src/lib/listing';
import { labelsHtml, zplForItems } from '../src/lib/zpl';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';
import type { Item } from '../src/lib/types';

/**
 * Label queue: pick the items that need a label (defaults to everything
 * with status Draft or Unlisted — the "to list" pile), then:
 *   - Save ZPL: writes labels.zpl to the app documents folder. Send that
 *     file to the Zebra printer (Zebra Setup Utilities / Browser Print).
 *     Each label is a 2" x 1" ZPL block with a ^BQ QR code.
 *   - Export PDF: a printable sheet of the same labels, for a normal printer.
 */
export default function LabelsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zplPath, setZplPath] = useState('');

  useFocusEffect(
    useCallback(() => {
      const all = getAllItems();
      setItems(all);
      setSelected(
        new Set(all.filter((it) => it.status === 'Draft' || it.status === 'Unlisted').map((it) => it.id)),
      );
    }, []),
  );

  const chosen = useMemo(() => items.filter((it) => selected.has(it.id)), [items, selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveZpl = async () => {
    if (chosen.length === 0) {
      Alert.alert('Nothing selected', 'Pick at least one item first.');
      return;
    }
    const zpl = zplForItems(chosen);
    const path = `${FileSystem.documentDirectory}labels.zpl`;
    await FileSystem.writeAsStringAsync(path, zpl);
    setZplPath(path);
    Alert.alert(
      'ZPL saved',
      `${chosen.length} label(s) written to labels.zpl in the app documents folder. Send it to your Zebra printer with Zebra Setup Utilities or Browser Print.`,
    );
  };

  const exportPdf = async () => {
    if (chosen.length === 0) {
      Alert.alert('Nothing selected', 'Pick at least one item first.');
      return;
    }
    await Print.printAsync({ html: labelsHtml(chosen) });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <Text style={styles.summary}>
        {chosen.length} selected · defaults to Draft + Unlisted ({items.filter((i) => i.status === 'Draft' || i.status === 'Unlisted').length} items)
      </Text>
      <View style={styles.btnRow}>
        <Pressable style={styles.btn} onPress={() => void saveZpl()}>
          <Text style={styles.btnText}>Save ZPL file</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void exportPdf()}>
          <Text style={styles.btnText}>Export PDF sheet</Text>
        </Pressable>
      </View>
      {zplPath !== '' && <Text style={styles.note}>ZPL saved: {zplPath}</Text>}
      <Text style={styles.note}>
        Zebra: 2&quot; × 1&quot; labels, 203 dpi, ^BQ QR. Print one test label and scan it before a batch.
      </Text>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item.id)} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.check}>{on ? '☑' : '☐'}</Text>
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {cleanName(item.name)}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.id} · {item.status}
                </Text>
              </View>
              <QRCode value={item.qrCode} size={44} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  check: { fontSize: 22, marginRight: spacing.sm },
  container: { backgroundColor: colors.background, flex: 1 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18, paddingBottom: 6, paddingHorizontal: spacing.lg },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  summary: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
