// SyncBanner — the "back online, out of sync" banner. It sits above the
// whole app (root layout) and appears only when the app has changes the
// sheet does not (out-of-sync flag) AND the device is back online
// (NetInfo). "Sync now" takes Austin straight to the Sync screen and
// starts the check, so one tap begins the catch-up. Until he syncs, item
// transactions are gated (see useOutOfSync in the Add, Item and
// Inventory screens), so nothing else can drift further out of sync.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useRouter } from 'expo-router';
import { isOutOfSync, onOutOfSyncChange } from '../lib/db';
import { colors, radius, spacing } from '../lib/ui';

export default function SyncBanner() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  const refresh = useCallback(() => {
    NetInfo.fetch().then((state) => {
      setVisible(isOutOfSync() && !!state.isConnected);
    });
  }, []);

  useEffect(() => {
    refresh();
    const unsubNet = NetInfo.addEventListener(() => refresh());
    const unsubFlag = onOutOfSyncChange(refresh);
    return () => {
      unsubNet();
      unsubFlag();
    };
  }, [refresh]);

  if (!visible) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text} numberOfLines={2}>
        You&apos;re back online — the app and sheet are out of sync.
      </Text>
      <Pressable
        style={styles.btn}
        onPress={() => router.push('/sync?auto=1')}
        accessibilityLabel="Sync now"
      >
        <Text style={styles.btnText}>Sync now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: '#fff8e1',
    borderBottomColor: '#e8c547',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  text: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 19 },
});
