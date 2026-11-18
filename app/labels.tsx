import { useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems } from '../src/lib/db';
import { labelsHtml, labelsPrintFragment, shortName, zplForItems } from '../src/lib/zpl';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';
import type { Item } from '../src/lib/types';
import { qrFor } from '../src/lib/types';

/**
 * Label queue: pick the items that need a label (defaults to everything
 * with status Draft or Unlisted — the "to list" pile), then:
 *   - Save ZPL: on the phone it writes labels.zpl to the app documents
 *     folder; on web it downloads labels.zpl. Send that file to the Zebra
 *     printer (Zebra Setup Utilities / Browser Print). Each label is a
 *     2" x 1" ZPL block with a ^BQ QR code.
 *   - Export PDF: a printable sheet of the same labels. On web this opens
 *     the browser's own print dialog right on this page (no new tab) —
 *     pick the Zebra GC420T there. On the phone it makes a PDF file and
 *     opens the share sheet so it can be saved to Files.
 * Bulk: Select All (192), Select To List (59), Clear. Labels show the
 * short name (max 24 chars, no prices) + QR + RB-xxx.
 */
export default function LabelsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zplPath, setZplPath] = useState('');

  useFocusEffect(
    useCallback(() => {
      // Deleted items live only in the sheet — they are not listed here.
      const all = getAllItems().filter((it) => it.status !== 'Deleted');
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

  const selectAll = () => setSelected(new Set(items.map((it) => it.id)));
  const selectToList = () =>
    setSelected(
      new Set(
        items.filter((it) => it.status === 'Draft' || it.status === 'Unlisted').map((it) => it.id),
      ),
    );
  const clearSelection = () => setSelected(new Set());

  const saveZpl = async () => {
    if (chosen.length === 0) {
      Alert.alert('Nothing selected', 'Pick at least one item first.');
      return;
    }
    const zpl = zplForItems(chosen);
    if (Platform.OS === 'web') {
      // No app documents folder on web — download the file instead.
      const blob = new Blob([zpl], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'labels.zpl';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
      setZplPath('labels.zpl (downloaded)');
      Alert.alert('ZPL downloaded', `${chosen.length} label(s) saved as labels.zpl.`);
      return;
    }
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
    if (Platform.OS === 'web') {
      // expo-print on web just prints the current app page and ignores the
      // HTML passed in, so inject the label sheet into a hidden div on this
      // page and call the browser's own print dialog — no new tab. The
      // injected print CSS hides the app itself while printing. In the
      // dialog pick the Zebra GC420T (2" x 1", margins None, scale 100%)
      // or "Save as PDF".
      const printRoot = document.createElement('div');
      printRoot.id = 'reseller-print-root';
      printRoot.innerHTML = labelsPrintFragment(chosen);
      document.body.appendChild(printRoot);
      const cleanup = () => {
        printRoot.remove();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      // Wait for the QR images to load so they print, with a timeout
      // fallback so a slow image never blocks printing entirely.
      await new Promise<void>((resolve) => {
        const imgs = Array.from(printRoot.querySelectorAll('img'));
        if (imgs.length === 0) return resolve();
        let remaining = imgs.length;
        const oneDone = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
        };
        imgs.forEach((img) => {
          if (img.complete) oneDone();
          else {
            img.addEventListener('load', oneDone);
            img.addEventListener('error', oneDone);
          }
        });
        setTimeout(resolve, 2000);
      });
      window.print();
      // Fallback cleanup in case afterprint doesn't fire.
      setTimeout(cleanup, 10000);
      return;
    }
    // On the phone: build a PDF file and open the share sheet, so it can
    // be saved to Files (or sent anywhere) instead of going to a printer.
    const { uri } = await Print.printToFileAsync({ html: labelsHtml(chosen) });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Save labels PDF',
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('PDF saved', `Labels PDF written to ${uri}`);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: spacing.sm }]}>
      <Text style={styles.summary}>
        {chosen.length} selected · defaults to Draft + Unlisted ({items.filter((i) => i.status === 'Draft' || i.status === 'Unlisted').length} items)
      </Text>
      <View style={styles.btnRow}>
        <Pressable style={styles.btnSecondary} onPress={selectAll}>
          <Text style={styles.btnSecondaryText}>Select all ({items.length})</Text>
        </Pressable>
        <Pressable style={styles.btnSecondary} onPress={selectToList}>
          <Text style={styles.btnSecondaryText}>Select To List</Text>
        </Pressable>
        <Pressable style={styles.btnSecondary} onPress={clearSelection}>
          <Text style={styles.btnSecondaryText}>Clear</Text>
        </Pressable>
      </View>
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
      {Platform.OS === 'web' ? (
        <Text style={styles.note}>
          On web, Export PDF opens the browser print dialog right here — pick the Zebra GC420T (2&quot; × 1&quot;, margins None, scale 100%) or Save as PDF.
        </Text>
      ) : (
        <Text style={styles.note}>
          Export PDF makes a PDF file and opens the share sheet — pick Save to Files to keep it.
        </Text>
      )}
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
                  {shortName(item.name)}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.id} · {item.status}
                </Text>
              </View>
              <QRCode value={qrFor(item.id)} size={44} />
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
  btnSecondary: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  btnSecondaryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
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
