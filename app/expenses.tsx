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
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addExpense,
  deleteExpense,
  getExpenses,
  getSettings,
  replaceExpenses,
  updateExpense,
} from '../src/lib/db';
import { fetchExpenseRows, pushExpenseRows } from '../src/lib/sync';
import { formatMoney } from '../src/lib/pricing';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';
import type { Expense } from '../src/lib/types';

function todayStr(): string {
  return new Date().toLocaleDateString('en-US');
}

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
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

  const remove = () => {
    if (!editingId) return;
    const target = expenses.find((e) => e.id === editingId);
    Alert.alert(
      `Delete “${target?.name ?? 'this expense'}”?`,
      'It will be removed from the app. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteExpense(editingId);
            setNote('Expense deleted.');
            clearForm();
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
      setNote(`Refreshed from the sheet: ${rows.length} expenses.`);
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
      `This replaces the sheet's Expenses tab with the app's ${expenses.length} expenses. Rows only in the sheet will be lost.`,
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
              setNote(
                `Sent to the sheet: ${r.count} expenses written.` +
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

  const total = expenses.reduce((a, e) => a + e.price, 0);

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
          {expenses.length} expense{expenses.length === 1 ? '' : 's'} · counted in Money on Hand
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
      <TextInput
        style={styles.input}
        value={date}
        onChangeText={setDate}
        placeholder="Date — M/d/yyyy"
        autoCapitalize="none"
        returnKeyType="done"
      />
      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>{editingId ? 'Save changes' : 'Add expense'}</Text>
      </Pressable>
      {editingId && (
        <View style={styles.editRow}>
          <Pressable style={[styles.btn, styles.dangerBtn]} onPress={remove}>
            <Text style={styles.btnText}>Delete</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.secondaryBtn]} onPress={clearForm}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {!!note && <Text style={styles.note}>{note}</Text>}

      <Text style={styles.label}>All expenses</Text>
      {expenses.length === 0 ? (
        <Text style={styles.empty}>No expenses yet. Add one above, or refresh from the sheet.</Text>
      ) : (
        <FlatList
          data={[...expenses].sort((a, b) => a.id.localeCompare(b.id))}
          keyExtractor={(e) => e.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, editingId === item.id && styles.rowSelected]}
              onPress={() => startEdit(item)}
            >
              <View style={styles.rowMain}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {item.date}
                  {item.status ? ` · ${item.status}` : ''}
                </Text>
              </View>
              <Text style={styles.rowPrice}>{formatMoney(item.price)}</Text>
            </Pressable>
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

const styles = StyleSheet.create({
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
  dangerBtn: { backgroundColor: '#b42318', flex: 1 },
  editRow: { flexDirection: 'row', gap: spacing.sm },
  empty: { color: colors.muted, fontSize: 15, marginTop: spacing.sm },
  input: {
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
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowPrice: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowSelected: { backgroundColor: colors.chip },
  secondaryBtn: { backgroundColor: '#57606a', flex: 1 },
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
