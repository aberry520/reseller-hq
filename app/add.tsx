import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addItem } from '../src/lib/db';
import { pushItemsToSheetLive } from '../src/lib/sync';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [purchase, setPurchase] = useState('');
  const [estShip, setEstShip] = useState('10');
  const [place, setPlace] = useState('Mac.Bid');
  const [datePurchased, setDatePurchased] = useState(new Date().toLocaleDateString('en-US'));
  const [notes, setNotes] = useState('');
  const router = useRouter();

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the item a name first.');
      return;
    }
    const item = addItem({
      name: name.trim(),
      purchase: parseFloat(purchase) || 0,
      estShip: parseFloat(estShip) || 0,
      place: place.trim(),
      datePurchased: datePurchased.trim(),
      notes: notes.trim(),
    });
    // The new item goes to the sheet right away too (and pops up if offline).
    pushItemsToSheetLive([item]);
    router.push(`/item/${item.id}`);
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
      <Text style={styles.label}>Item name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Klymit Static V Sleeping Pad" returnKeyType="next" />
      <Text style={styles.label}>Purchase / winning bid ($)</Text>
      <TextInput style={styles.input} value={purchase} onChangeText={setPurchase} keyboardType="decimal-pad" placeholder="0.00" returnKeyType="next" />
      <Text style={styles.label}>Est. shipping ($)</Text>
      <TextInput style={styles.input} value={estShip} onChangeText={setEstShip} keyboardType="decimal-pad" returnKeyType="next" />
      <Text style={styles.label}>Place of purchase</Text>
      <TextInput style={styles.input} value={place} onChangeText={setPlace} returnKeyType="next" />
      <Text style={styles.label}>Date purchased</Text>
      <TextInput style={styles.input} value={datePurchased} onChangeText={setDatePurchased} returnKeyType="next" />
      <Text style={styles.label}>Notes</Text>
      <TextInput style={styles.input} value={notes} onChangeText={setNotes} multiline />
      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>Save item</Text>
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
});
