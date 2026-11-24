// Mark as labeled — its own tool, separate from Scan QR. Scan QR opens
// an item; this one stays on the camera so a batch of labels can be
// worked through: enter the location first, then point at each label as
// it goes on the item. Every scan marks the item labeled AND puts it at
// that location — scanning to a location means it is labeled. The list
// below the camera shows everything marked in this session, with an
// Undo per row for a mis-scan (Undo restores the location and labeled
// state the item had before). The camera fires repeatedly while a code
// is in frame, so the same code is ignored for 2 seconds after it is read.

import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { idFromQr } from '../src/lib/types';
import { getItem, updateItem } from '../src/lib/db';
import { pushItemsToSheetLive } from '../src/lib/sync';
import { cleanName } from '../src/lib/listing';
import { minTouchHeight, radius, spacing } from '../src/lib/ui';
import { useThemedStyles } from '../src/lib/theme-context';
import type { ThemeColors } from '../src/lib/themes';

type Marked = {
  id: string;
  name: string;
  location: string;
  // What the item had before this scan, so Undo can put it back.
  prevLocation: string;
  prevLabeled: boolean;
};

export default function MarkLabeledScreen() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [marked, setMarked] = useState<Marked[]>([]);
  // The location every scan in this batch goes to. Entered before
  // scanning starts; a fresh batch means a fresh location, so it is
  // not remembered between visits.
  const [location, setLocation] = useState('');
  // Last code read + when, so the same label held in frame is not
  // marked (and listed) over and over.
  const lastScanRef = useRef({ code: '', at: 0 });

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={[styles.center, { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.text}>Camera permission is needed to scan QR labels.</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant camera permission</Text>
        </Pressable>
      </View>
    );
  }

  const onScan = ({ data }: { data: string }) => {
    const now = Date.now();
    if (data === lastScanRef.current.code && now - lastScanRef.current.at < 2000) return;
    lastScanRef.current = { code: data, at: now };
    const id = idFromQr(data);
    if (!id) {
      setMessageOk(false);
      setMessage(`Not a Reseller HQ code: ${data}`);
      return;
    }
    const item = getItem(id);
    if (!item) {
      setMessageOk(false);
      setMessage(`No item found for ${id}`);
      return;
    }
    const loc = location.trim();
    const targetLocation = loc === '' ? item.location : loc;
    // Nothing to do: already labeled, and already at this location
    // (or no location was given).
    if (item.labeled && item.location === targetLocation) {
      setMessageOk(true);
      setMessage(
        loc === '' ? `${id} is already labeled` : `${id} is already labeled at ${loc}`,
      );
      return;
    }
    // A scannable QR proves the physical label is on the item — so a
    // scan to a location means it is labeled, and it lives there now.
    const next = { ...item, labeled: true, location: targetLocation };
    updateItem(id, { labeled: true, location: targetLocation });
    // Location is a sheet field, so it goes to the sheet right away
    // (and pops up if offline), like every other write-through.
    pushItemsToSheetLive([next]);
    setMarked((prev) => [
      {
        id,
        name: cleanName(item.name),
        location: targetLocation,
        prevLocation: item.location,
        prevLabeled: item.labeled,
      },
      ...prev.filter((m) => m.id !== id),
    ]);
    setMessageOk(true);
    setMessage(
      loc === ''
        ? `✓ ${id} marked as labeled`
        : `✓ ${id} labeled at ${loc}`,
    );
  };

  const undo = (id: string) => {
    const entry = marked.find((m) => m.id === id);
    const current = getItem(id);
    if (!current) return;
    const next = {
      ...current,
      labeled: entry?.prevLabeled ?? false,
      location: entry?.prevLocation ?? '',
    };
    updateItem(id, { labeled: next.labeled, location: next.location });
    pushItemsToSheetLive([next]);
    setMarked((prev) => prev.filter((m) => m.id !== id));
    setMessageOk(false);
    setMessage(
      entry?.prevLabeled ? `${id} location restored` : `${id} unmarked`,
    );
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScan}
      />
      <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg }]}>
        <TextInput
          style={styles.locationInput}
          placeholder="Location — shelf, bin, garage…"
          value={location}
          onChangeText={setLocation}
          returnKeyType="done"
          autoCapitalize="none"
        />
        <Text style={styles.text}>
          Enter the location first, then scan each label as you stick it on — the item is
          marked labeled and put at that location.
        </Text>
        {message !== '' && (
          <Text style={[styles.message, messageOk && styles.messageOk]}>{message}</Text>
        )}
        <Text style={styles.count}>
          {marked.length === 0
            ? 'Nothing marked yet this session'
            : `${marked.length} marked this session`}
        </Text>
        <FlatList
          data={marked}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.id} · Labeled ✓{item.location ? ` · ${item.location}` : ''}
                </Text>
              </View>
              <Pressable style={styles.undoBtn} onPress={() => undo(item.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={styles.undoText}>Undo</Text>
              </Pressable>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    btn: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: radius.sm,
      justifyContent: 'center',
      marginTop: spacing.md,
      minHeight: minTouchHeight,
      paddingHorizontal: 14,
      paddingVertical: spacing.md,
    },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    camera: { flex: 1 },
    center: {
      alignItems: 'center',
      backgroundColor: colors.background,
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    container: { backgroundColor: colors.background, flex: 1 },
    count: { color: colors.muted, fontSize: 14, fontWeight: '600', marginTop: spacing.sm },
    locationInput: {
      backgroundColor: colors.field,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      fontSize: 16,
      marginBottom: spacing.sm,
      minHeight: minTouchHeight,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    message: { color: colors.danger, fontSize: 15, marginTop: spacing.sm, textAlign: 'center' },
    messageOk: { color: colors.success },
    panel: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.divider,
      borderBottomWidth: 1,
      flexDirection: 'row',
      paddingVertical: spacing.sm,
    },
    rowMain: { flex: 1, marginRight: spacing.sm },
    rowMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
    rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: colors.text, fontSize: 16, lineHeight: 22, textAlign: 'center' },
    undoBtn: {
      alignItems: 'center',
      backgroundColor: colors.chip,
      borderRadius: radius.sm,
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: spacing.md,
    },
    undoText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  });
