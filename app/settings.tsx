import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSettings, saveSettings } from '../src/lib/db';
import { getEbayStatus } from '../src/services/ebay';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';
import type { Settings } from '../src/lib/types';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<Settings | null>(null);

  useFocusEffect(
    useCallback(() => {
      setS(getSettings());
    }, []),
  );

  if (!s) return null;
  const ebay = getEbayStatus();

  const save = () => {
    saveSettings(s);
    Alert.alert('Saved', 'Settings saved on this device.');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Background remover URL</Text>
      <TextInput
        style={styles.input}
        value={s.bgRemoverUrl}
        onChangeText={(v) => setS({ ...s, bgRemoverUrl: v })}
        placeholder="http://192.168.1.50:8000 (leave blank to skip)"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
      />
      <Text style={styles.note}>
        The backend/ folder in this repo runs the remover on your laptop. Your phone must be on
        the same Wi-Fi. Blank = photos stay as taken.
      </Text>

      <Text style={styles.label}>Warehouse</Text>
      <TextInput style={styles.input} value={s.warehouse} onChangeText={(v) => setS({ ...s, warehouse: v })} returnKeyType="next" />

      <Text style={styles.label}>eBay fee % (13.6 = 0.136)</Text>
      <TextInput
        style={styles.input}
        value={String(s.ebayFeePct)}
        onChangeText={(v) => setS({ ...s, ebayFeePct: parseFloat(v) || 0.136 })}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />

      <Text style={styles.label}>Target margin % (30 = 0.30)</Text>
      <TextInput
        style={styles.input}
        value={String(s.targetMarginPct)}
        onChangeText={(v) => setS({ ...s, targetMarginPct: parseFloat(v) || 0.3 })}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />

      <Text style={styles.label}>MAC.BID sales tax % — Anderson (7 = 0.07)</Text>
      <TextInput
        style={styles.input}
        value={String(s.salesTaxPct)}
        onChangeText={(v) => setS({ ...s, salesTaxPct: parseFloat(v) || 0.07 })}
        keyboardType="decimal-pad"
        returnKeyType="done"
      />

      <Text style={styles.label}>eBay</Text>
      <Text style={styles.note}>{ebay.message}</Text>

      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>Save settings</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 52,
    paddingVertical: spacing.md,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  container: { backgroundColor: colors.background, flex: 1 },
  content: { paddingHorizontal: spacing.lg },
  input: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    marginTop: spacing.xs,
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  label: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: spacing.lg },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
});
