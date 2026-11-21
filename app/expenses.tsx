// Expenses — the app's version of the sheet's Expenses tab.
// List, add, edit and delete expenses locally, and sync them with the
// sheet: "Refresh from sheet" replaces the local list with the sheet's,
// "Send to sheet" replaces the sheet's list with the app's. The Expenses
// tab has no App ID column, so both directions are whole-list replaces
// (the same idea as the inventory overwrite), not a merge.
// The dashboard's Money on Hand uses these expenses.

import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addExpense,
  getExpenses,
  getSettings,
  replaceExpenses,
  updateExpense,
} from '../src/lib/db';
import { fetchExpenseRows, pushExpenseRows } from '../src/lib/sync';
import DateField from '../src/components/DateField';
import { formatMoney } from '../src/lib/pricing';
import { minTouchHeight, radius, spacing } from '../src/lib/ui';
import { useTheme, useThemedStyles } from '../src/lib/theme-context';
import type { ThemeColors } from '../src/lib/themes';
import type { Expense } from '../src/lib/types';

function todayStr(): string {
  return new Date().toLocaleDateString('en-US');
}

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(todayStr());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setExpenses(getExpenses());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const configured = () => {
    const s = getSettings();
    return s.syncUrl.trim() !== '' && s.syncToken.trim() !== '';
  };

  const clearForm = () => {
    setName('');
    setPrice('');
    setDate(todayStr());
    setEditingId(null);
  };

  const save = () => {
    const n = name.trim();
    const p = parseFloat(price);
    if (!n) {
      setNote('Give the expense a name first.');
      return;
    }
    if (!Number.isFinite(p) || p < 0) {
      setNote('Enter a price (a number, 0 or more).');
      return;
    }
    if (editingId) {
      updateExpense(editingId, { name: n, price: p, date: date.trim() });
      setNote(`Updated “${n}”.`);
    } else {
      addExpense({ name: n, price: p, date: date.trim() });
      setNote(`Added “${n}”.`);
    }
    clearForm();
    reload();
  };

  const startEdit = (e: Expense) => {
    setEditingId(e.id);
    setName(e.name);
    setPrice(String(e.price));
    setDate(e.date);
    setNote('');
  };

  const removeExpense = (e: Expense) => {
    Alert.alert(
      `Delete “${e.name}”?`,
      'It will be marked Deleted — hidden from the app, but kept in the sheet so it can be restored.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            updateExpense(e.id, { status: 'Deleted' });
            setNote('Expense marked Deleted.');
            if (editingId === e.id) clearForm();
            reload();
          },
        },
      ],
    );
  };

  const refreshFromSheet = async () => {
    if (!configured()) {
      setNote('Set up sheet sync in Settings first (URL + token).');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const rows = await fetchExpenseRows();
      replaceExpenses(rows);
      reload();
      // The sheet keeps Deleted rows (so they can be restored); the count
      // shown is the live ones only.
      const live = rows.filter((r) => (r.status || '').trim() !== 'Deleted').length;
      setNote(`Refreshed from the sheet: ${live} expenses.`);
    } catch (e) {
      setNote(`Could not reach the sheet: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy(false);
    }
  };

  const sendToSheet = async () => {
    if (!configured()) {
      setNote('Set up sheet sync in Settings first (URL + token).');
      return;
    }
    Alert.alert(
      'Send expenses to the sheet?',
      `This replaces the sheet's Expenses tab with the app's ${expenses.filter((e) => (e.status || '').trim() !== 'Deleted').length} expenses. Rows only in the sheet will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send to sheet',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setNote('');
            try {
              const r = await pushExpenseRows(getExpenses());
              // r.count is the rows the server wrote (it keeps Deleted rows
              // in the sheet so they can be restored); the count shown is
              // the live ones only.
              const live = getExpenses().filter((e) => (e.status || '').trim() !== 'Deleted').length;
              setNote(
                `Sent to the sheet: ${live} expenses written.` +
                  (r.errors.length > 0 ? ` Errors: ${r.errors.slice(0, 3).join('; ')}` : ''),
              );
            } catch (e) {
              setNote(`Could not reach the sheet: ${e instanceof Error ? e.message : 'error'}`);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  // Deleted expenses are hidden from the app (they live only in the
  // sheet). The full list (including Deleted) is what "Send to sheet"
  // writes, so the sheet keeps them as Deleted. The count shown is the
  // live ones only.
  const visible = expenses.filter((e) => (e.status || '').trim() !== 'Deleted');
  const total = visible.reduce((a, e) => a + e.price, 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xl, paddingTop: spacing.md },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total expenses</Text>
        <Text style={styles.totalValue}>{formatMoney(total)}</Text>
        <Text style={styles.totalMeta}>
          {visible.length} expense{visible.length === 1 ? '' : 's'} · counted in Money on Hand
        </Text>
      </View>

      <Text style={styles.label}>{editingId ? 'Edit expense' : 'Add expense'}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Name — Tape, MacBid, payout…"
        autoCapitalize="none"
        returnKeyType="next"
      />
      <TextInput
        style={styles.input}
        value={price}
        onChangeText={setPrice}
        placeholder="Price — 29.99"
        keyboardType="decimal-pad"
        returnKeyType="next"
      />
      <View style={styles.dateField}>
        <DateField label="Date" value={date} onChange={setDate} />
      </View>
      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>{editingId ? 'Save changes' : 'Add expense'}</Text>
      </Pressable>
      {editingId && (
        <View style={styles.editRow}>
          <Pressable
            style={[styles.btn, styles.dangerBtn]}
            onPress={() => {
              const e = expenses.find((x) => x.id === editingId);
              if (e) removeExpense(e);
            }}
          >
            <Text style={styles.btnText}>Delete</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.secondaryBtn]} onPress={clearForm}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {!!note && <Text style={styles.note}>{note}</Text>}

      <Text style={styles.label}>All expenses</Text>
      <Text style={styles.note}>Tap a row or the pencil to edit it; the trash deletes it.</Text>
      {visible.length === 0 ? (
        <Text style={styles.empty}>No expenses yet. Add one above, or refresh from the sheet.</Text>
      ) : (
        <FlatList
          data={[...visible].sort((a, b) => a.id.localeCompare(b.id))}
          keyExtractor={(e) => e.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={[styles.row, editingId === item.id && styles.rowSelected]}>
              <Pressable style={styles.rowMain} onPress={() => startEdit(item)}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {item.date}
                  {item.status ? ` · ${item.status}` : ''}
                </Text>
              </Pressable>
              <Text style={styles.rowPrice}>{formatMoney(item.price)}</Text>
              <Pressable
                style={styles.rowAction}
                onPress={() => startEdit(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Edit ${item.name}`}
              >
                <Ionicons name="pencil-outline" size={20} color={colors.primary} />
              </Pressable>
              <Pressable
                style={styles.rowAction}
                onPress={() => removeExpense(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Delete ${item.name}`}
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </View>
          )}
        />
      )}

      <Text style={styles.label}>Sheet sync</Text>
      <Text style={styles.note}>
        The sheet's Expenses tab is the shared copy. Refresh pulls it into the app; Send pushes
        the app's list to the sheet (replacing it).
      </Text>
      <Pressable style={[styles.btn, styles.secondaryBtn]} onPress={refreshFromSheet} disabled={busy}>
        <Text style={styles.btnText}>{busy ? 'Working…' : 'Refresh from sheet'}</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.dangerBtn]} onPress={sendToSheet} disabled={busy}>
        <Text style={styles.btnText}>{busy ? 'Working…' : 'Send to sheet'}</Text>
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
      marginTop: spacing.md,
      minHeight: 52,
      paddingVertical: spacing.md,
    },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
    container: { backgroundColor: colors.background, flex: 1 },
    content: { paddingHorizontal: spacing.lg },
    dangerBtn: { backgroundColor: colors.danger, flex: 1 },
    dateField: { marginTop: spacing.sm },
    editRow: { flexDirection: 'row', gap: spacing.sm },
    empty: { color: colors.muted, fontSize: 15, marginTop: spacing.sm },
    input: {
      backgroundColor: colors.field,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      marginTop: spacing.sm,
      minHeight: minTouchHeight,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    label: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: spacing.lg },
    note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.divider,
      borderBottomWidth: 1,
      flexDirection: 'row',
      minHeight: 60,
      paddingVertical: spacing.sm,
    },
    rowAction: { marginLeft: spacing.sm, padding: spacing.xs },
    rowMain: { flex: 1, marginRight: spacing.sm },
    rowMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
    rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    rowPrice: { color: colors.text, fontSize: 16, fontWeight: '700' },
    rowSelected: { backgroundColor: colors.chip },
    secondaryBtn: { backgroundColor: colors.muted, flex: 1 },
    totalCard: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
    },
    totalLabel: { color: colors.muted, fontSize: 14, fontWeight: '600' },
    totalMeta: { color: colors.muted, fontSize: 13, marginTop: spacing.xs },
    totalValue: { color: colors.text, fontSize: 32, fontWeight: '800', marginTop: spacing.xs },
  });
