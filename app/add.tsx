import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { addItem } from '../src/lib/db';

export default function AddScreen() {
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
    router.push(`/item/${item.id}`);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Item name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Klymit Static V Sleeping Pad" />
      <Text style={styles.label}>Purchase / winning bid ($)</Text>
      <TextInput style={styles.input} value={purchase} onChangeText={setPurchase} keyboardType="decimal-pad" placeholder="0.00" />
      <Text style={styles.label}>Est. shipping ($)</Text>
      <TextInput style={styles.input} value={estShip} onChangeText={setEstShip} keyboardType="decimal-pad" />
      <Text style={styles.label}>Place of purchase</Text>
      <TextInput style={styles.input} value={place} onChangeText={setPlace} />
      <Text style={styles.label}>Date purchased</Text>
      <TextInput style={styles.input} value={datePurchased} onChangeText={setDatePurchased} />
      <Text style={styles.label}>Notes</Text>
      <TextInput style={styles.input} value={notes} onChangeText={setNotes} multiline />
      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>Save item</Text>
      </Pressable>
    </View>
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
  container: { backgroundColor: '#fff', flex: 1, padding: 12 },
  input: {
    borderColor: '#d0d7de',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: { fontWeight: '700', marginTop: 12 },
});
