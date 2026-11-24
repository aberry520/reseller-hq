// Mark as labeled — its own tool, separate from Scan QR. Scan QR opens
// an item; this one stays on the camera so a batch of labels can be
// worked through: point at each label as it goes on the item, and the
// item is marked labeled right away. The list below the camera shows
// everything marked in this session, with an Undo per row for a
// mis-scan. The camera fires repeatedly while a code is in frame, so
// the same code is ignored for 2 seconds after it is read.

import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { idFromQr } from '../src/lib/types';
import { getItem, updateItem } from '../src/lib/db';
import { cleanName } from '../src/lib/listing';
import { minTouchHeight, radius, spacing } from '../src/lib/ui';
import { useThemedStyles } from '../src/lib/theme-context';
import type { ThemeColors } from '../src/lib/themes';

type Marked = { id: string; name: string };

export default function MarkLabeledScreen() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(createStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [marked, setMarked] = useState<Marked[]>([]);
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
    if (item.labeled) {
      setMessageOk(true);
      setMessage(`${id} is already labeled`);
      return;
    }
    // A scannable QR proves the physical label is on the item.
    updateItem(id, { labeled: true });
    setMarked((prev) => [{ id, name: cleanName(item.name) }, ...prev]);
    setMessageOk(true);
    setMessage(`✓ ${id} marked as labeled`);
  };

  const undo = (id: string) => {
    updateItem(id, { labeled: false });
    setMarked((prev) => prev.filter((m) => m.id !== id));
    setMessageOk(false);
    setMessage(`${id} unmarked`);
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
        <Text style={styles.text}>
          Scan each label as you stick it on — the item is marked labeled right away.
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
                <Text style={styles.rowMeta}>{item.id} · Labeled ✓</Text>
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
