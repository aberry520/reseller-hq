import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getSettings, saveSettings, clearLocalData } from '../../src/lib/db';
import { getEbayStatus } from '../../src/services/ebay';
import { minTouchHeight, radius, spacing } from '../../src/lib/ui';
import { useTheme, useThemedStyles } from '../../src/lib/theme-context';
import { THEME_ORDER, THEMES } from '../../src/lib/themes';
import type { ThemeColors } from '../../src/lib/themes';
import type { Settings } from '../../src/lib/types';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, themeName, setTheme } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [s, setS] = useState<Settings | null>(null);

  useFocusEffect(
    useCallback(() => {
      setS(getSettings());
    }, []),
  );

  if (!s) return null;
  const ebay = getEbayStatus();

  const save = () => {
    // The theme lives in the theme provider (it applies the moment it
    // is tapped), so always write the provider's current theme rather
    // than whatever this form loaded on focus.
    saveSettings({ ...s, theme: themeName });
    Alert.alert('Saved', 'Settings saved on this device.');
  };

  const pickTheme = (name: (typeof THEME_ORDER)[number]) => {
    setTheme(name);
    setS((prev) => (prev ? { ...prev, theme: name } : prev));
  };

  const clear = () => {
    Alert.alert(
      'Clear local data?',
      'This deletes everything stored on this device — items and their photos, Free items, Expenses, and sync history — and leaves the app empty. Your settings (including the sync URL and token) are kept, and the sheet itself is never touched. Use Sync → “Update app from sheet” afterwards to fill the app again from the sheet. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear everything',
          style: 'destructive',
          onPress: () => {
            clearLocalData();
            Alert.alert(
              'Local data cleared',
              'The app is empty now. Your settings were kept — go to Sync and use “Update app from sheet” to fill it again from the sheet.',
            );
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Appearance</Text>
      <Text style={styles.note}>
        Pick a color theme — it applies to the whole app right away and is remembered on this
        device.
      </Text>
      {THEME_ORDER.map((name) => {
        const t = THEMES[name];
        const active = name === themeName;
        return (
          <Pressable
            key={name}
            style={[styles.themeRow, active && styles.themeRowActive]}
            onPress={() => pickTheme(name)}
            accessibilityLabel={`Theme: ${t.label}`}
          >
            <View style={styles.swatches}>
              <View style={[styles.dot, { backgroundColor: t.colors.background, borderColor: t.colors.border }]} />
              <View style={[styles.dot, { backgroundColor: t.colors.card, borderColor: t.colors.border }]} />
              <View style={[styles.dot, { backgroundColor: t.colors.primary, borderColor: t.colors.primary }]} />
              <View style={[styles.dot, { backgroundColor: t.colors.success, borderColor: t.colors.success }]} />
            </View>
            <Text style={styles.themeLabel}>
              {t.label}
              {t.dark ? '  ·  Dark' : ''}
            </Text>
            {active && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
          </Pressable>
        );
      })}

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

      <Text style={styles.label}>Sheet sync URL</Text>
      <TextInput
        style={styles.input}
        value={s.syncUrl}
        onChangeText={(v) => setS({ ...s, syncUrl: v })}
        placeholder="https://script.google.com/macros/s/.../exec"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
      />
      <Text style={styles.note}>
        The Web app URL from deploying sync/sheet-sync.gs (Extensions → Apps Script in the
        sheet). Blank = sync off.
      </Text>

      <Text style={styles.label}>Sheet tab name</Text>
      <TextInput
        style={styles.input}
        value={s.syncSheet}
        onChangeText={(v) => setS({ ...s, syncSheet: v })}
        placeholder="Inventory"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
      />
      <Text style={styles.note}>
        The tab the sync reads and writes (default Inventory). Everything lives on one tab now;
        a free item is a row whose cost is 0.
      </Text>

      <Text style={styles.label}>Sheet sync token</Text>
      <TextInput
        style={styles.input}
        value={s.syncToken}
        onChangeText={(v) => setS({ ...s, syncToken: v })}
        placeholder="The SYNC_TOKEN script property value"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        returnKeyType="next"
      />
      <Text style={styles.note}>
        The password the app sends with every sync request. Keep it private — anyone with the
        URL and this token can change the sheet.
      </Text>

      <Text style={styles.label}>eBay</Text>
      <Text style={styles.note}>{ebay.message}</Text>

      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>Save settings</Text>
      </Pressable>

      <Text style={styles.label}>Local data</Text>
      <Text style={styles.note}>
        Start over on this device: deletes the items and their photos, Free items, Expenses, and
        sync history, and leaves the app empty (nothing is re-seeded). Your settings are kept,
        and the sheet itself is never touched. Use Sync → “Update app from sheet” to fill the
        app again from the sheet.
      </Text>
      <Pressable style={[styles.btn, styles.dangerBtn]} onPress={clear}>
        <Text style={styles.btnText}>Clear local data</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    dangerBtn: { backgroundColor: colors.danger, marginTop: spacing.md },
    dot: { borderRadius: 9, borderWidth: 1, height: 18, width: 18 },
    input: {
      backgroundColor: colors.field,
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
    swatches: { flexDirection: 'row', gap: 4, marginRight: spacing.md },
    themeLabel: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '600' },
    themeRow: {
      alignItems: 'center',
      backgroundColor: colors.field,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexDirection: 'row',
      marginTop: spacing.sm,
      minHeight: minTouchHeight,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    themeRowActive: { borderColor: colors.primary, borderWidth: 2 },
  });
