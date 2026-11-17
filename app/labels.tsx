import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { getAllItems } from '../src/lib/db';
import { cleanName } from '../src/lib/listing';
import { labelsHtml, zplForItems } from '../src/lib/zpl';
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
    <View style={styles.container}>
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
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item.id)}>
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
    backgroundColor: '#0969da',
    borderRadius: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btnRow: { flexDirection: 'row', padding: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
  check: { fontSize: 20, marginRight: 8 },
  container: { backgroundColor: '#fff', flex: 1 },
  note: { color: '#656d76', fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  row: {
    alignItems: 'center',
    borderBottomColor: '#eaeef2',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowMain: { flex: 1, marginRight: 8 },
  rowMeta: { color: '#656d76', fontSize: 12 },
  rowName: { fontSize: 14, fontWeight: '600' },
  summary: { fontWeight: '600', paddingHorizontal: 12, paddingTop: 12 },
});
