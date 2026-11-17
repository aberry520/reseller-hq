import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { idFromQr } from '../src/lib/types';
import { getItem } from '../src/lib/db';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  if (!permission) return <View style={[styles.container, { paddingTop: insets.top }]} />;
  if (!permission.granted) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.text}>Camera permission is needed to scan QR labels.</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant camera permission</Text>
        </Pressable>
      </View>
    );
  }

  const onScan = ({ data }: { data: string }) => {
    if (scanned) return;
    const id = idFromQr(data);
    if (!id) {
      setMessage(`Not a Reseller HQ code: ${data}`);
      return;
    }
    const item = getItem(id);
    if (!item) {
      setMessage(`No item found for ${id}`);
      return;
    }
    setScanned(true);
    router.push(`/item/${id}`);
    // Allow scanning again when the user comes back.
    setTimeout(() => setScanned(false), 1500);
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScan}
      />
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.text}>Point the camera at a QR label to open that item.</Text>
        {message !== '' && <Text style={styles.message}>{message}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
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
  message: { color: colors.danger, fontSize: 15, paddingBottom: spacing.sm, textAlign: 'center' },
  text: { color: colors.text, fontSize: 16, lineHeight: 22, textAlign: 'center' },
});
