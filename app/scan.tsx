import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { idFromQr } from '../src/lib/types';
import { getItem } from '../src/lib/db';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
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
      <Text style={styles.text}>Point the camera at a QR label to open that item.</Text>
      {message !== '' && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  btnText: { color: '#fff', fontWeight: '700' },
  camera: { flex: 1 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 16 },
  container: { backgroundColor: '#fff', flex: 1 },
  message: { color: '#cf222e', padding: 12, textAlign: 'center' },
  text: { padding: 12, textAlign: 'center' },
});
