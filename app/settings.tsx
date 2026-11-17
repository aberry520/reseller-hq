import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { getSettings, saveSettings } from '../src/lib/db';
import { getEbayStatus } from '../src/services/ebay';
import type { Settings } from '../src/lib/types';

export default function SettingsScreen() {
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Background remover URL</Text>
      <TextInput
        style={styles.input}
        value={s.bgRemoverUrl}
        onChangeText={(v) => setS({ ...s, bgRemoverUrl: v })}
        placeholder="http://192.168.1.50:8000 (leave blank to skip)"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.note}>
        The backend/ folder in this repo runs the remover on your laptop. Your phone must be on
        the same Wi-Fi. Blank = photos stay as taken.
      </Text>

      <Text style={styles.label}>Warehouse</Text>
      <TextInput style={styles.input} value={s.warehouse} onChangeText={(v) => setS({ ...s, warehouse: v })} />

      <Text style={styles.label}>eBay fee % (13.6 = 0.136)</Text>
      <TextInput
        style={styles.input}
        value={String(s.ebayFeePct)}
        onChangeText={(v) => setS({ ...s, ebayFeePct: parseFloat(v) || 0.136 })}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Target margin % (30 = 0.30)</Text>
      <TextInput
        style={styles.input}
        value={String(s.targetMarginPct)}
        onChangeText={(v) => setS({ ...s, targetMarginPct: parseFloat(v) || 0.3 })}
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>MAC.BID sales tax % — Anderson (7 = 0.07)</Text>
      <TextInput
        style={styles.input}
        value={String(s.salesTaxPct)}
        onChangeText={(v) => setS({ ...s, salesTaxPct: parseFloat(v) || 0.07 })}
        keyboardType="decimal-pad"
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
    backgroundColor: '#0969da',
    borderRadius: 8,
    marginTop: 16,
    paddingVertical: 12,
  },
  btnText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  container: { backgroundColor: '#fff', flex: 1 },
  content: { padding: 12 },
  input: {
    borderColor: '#d0d7de',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: { fontWeight: '700', marginTop: 12 },
  note: { color: '#656d76', fontSize: 13, marginTop: 4 },
});
