import { useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAllItems, getSettings, saveSettings } from '../src/lib/db';
import { labelsHtml, labelsPrintFragment, shortName, zplForItems, LABEL_FONT_SIZES } from '../src/lib/zpl';
import { minTouchHeight, radius, spacing } from '../src/lib/ui';
import { useTheme, useThemedStyles } from '../src/lib/theme-context';
import type { ThemeColors } from '../src/lib/themes';
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
 * Bulk: a checkbox per status selects/deselects every item with that
 * status (the screen opens with Draft + Unlisted — the "to list" pile —
 * selected), plus Select all and Clear. Labels show the short name
 * (max 24 chars, no prices) + QR + the item ID.
 */

// Statuses in journey order, for the filter checkboxes. Deleted items
// are never listed here, so Deleted is not offered.
const STATUS_ORDER = ['Draft', 'Unlisted', 'Listed', 'Sold', 'Trash', 'Return', 'Trash Return'];

export default function LabelsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zplPath, setZplPath] = useState('');
  // Label font size (ZPL dots), remembered in Settings so it only has
  // to be picked once. Bigger type wraps the name sooner (the line
  // splitting adapts), smaller type fits more per line.
  const [fontSize, setFontSize] = useState(26);

  useFocusEffect(
    useCallback(() => {
      // Deleted items live only in the sheet — they are not listed here.
      const all = getAllItems().filter((it) => it.status !== 'Deleted');
      setItems(all);
      setFontSize(getSettings().labelFontSize);
      setSelected(
        new Set(all.filter((it) => it.status === 'Draft' || it.status === 'Unlisted').map((it) => it.id)),
      );
    }, []),
  );

  const pickFontSize = (size: number) => {
    setFontSize(size);
    saveSettings({ ...getSettings(), labelFontSize: size });
  };

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
  const clearSelection = () => setSelected(new Set());

  // Status filter checkboxes: how many items carry each status, and
  // whether every one of them is currently selected.
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.status, (counts.get(it.status) ?? 0) + 1);
    return counts;
  }, [items]);

  const statusAllSelected = (status: string) =>
    items.filter((it) => it.status === status).every((it) => selected.has(it.id));

  // Tapping a status checkbox selects every item with that status, or
  // deselects them all when they are all selected already. Individual
  // rows can still be toggled in the list below.
  const toggleStatus = (status: string) => {
    const ids = items.filter((it) => it.status === status).map((it) => it.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const saveZpl = async () => {
    if (chosen.length === 0) {
      Alert.alert('Nothing selected', 'Pick at least one item first.');
      return;
    }
    const zpl = zplForItems(chosen, fontSize);
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
      printRoot.innerHTML = labelsPrintFragment(chosen, fontSize);
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
    const { uri } = await Print.printToFileAsync({ html: labelsHtml(chosen, fontSize) });
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
      <View style={styles.toolbar}>
        <Text style={styles.summary}>
          {chosen.length} of {items.length} selected
        </Text>
        <Pressable onPress={selectAll} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={styles.toolBtn}>Select all</Text>
        </Pressable>
        <Pressable onPress={clearSelection} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={styles.toolBtn}>Clear</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        style={styles.chipScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {STATUS_ORDER.filter((s) => (statusCounts.get(s) ?? 0) > 0).map((status) => {
          const checked = statusAllSelected(status);
          return (
            <Pressable
              key={status}
              style={[styles.chip, checked && styles.chipOn]}
              onPress={() => toggleStatus(status)}
              accessibilityLabel={`Select all ${status} items`}
            >
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={18}
                color={checked ? colors.primary : colors.muted}
              />
              <Text style={[styles.chipText, checked && styles.chipTextOn]}>
                {status === 'Unlisted' ? 'To List' : status}
              </Text>
              <Text style={styles.chipCount}>{statusCounts.get(status)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.fontRow}>
        <Text style={styles.fontLabel}>Label font</Text>
        {LABEL_FONT_SIZES.map((f) => {
          const on = fontSize === f.size;
          return (
            <Pressable
              key={f.key}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => pickFontSize(f.size)}
              accessibilityLabel={`Label font: ${f.label}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
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
        {Platform.OS === 'web'
          ? '2" × 1", 203 dpi. Export PDF opens the print dialog here — pick the Zebra GC420T (margins None, scale 100%). Print one test label and scan it first.'
          : '2" × 1", 203 dpi. Export PDF shares a PDF — Save to Files to keep it. Print one test label and scan it first.'}
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    btnRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    check: { fontSize: 22, marginRight: spacing.sm },
    chip: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
    },
    chipCount: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    chipOn: { backgroundColor: colors.chip, borderColor: colors.primary },
    chipRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
    },
    // A horizontal ScrollView stretches to fill the column by default,
    // which squeezed the item list out of view — pin it to the height
    // of the chips themselves so the list below gets the space.
    chipScroll: { flexGrow: 0, flexShrink: 0 },
    chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    chipTextOn: { color: colors.primary },
    container: { backgroundColor: colors.background, flex: 1 },
    fontLabel: { color: colors.muted, flex: 1, fontSize: 14, fontWeight: '600' },
    fontRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
    },
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
    summary: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
    toolbar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    toolBtn: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  });
