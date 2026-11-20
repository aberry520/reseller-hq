import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addItem } from '../src/lib/db';
import { pushItemsToSheetLive } from '../src/lib/sync';
import { pickPhotos } from '../src/lib/photo-utils';
import DateField from '../src/components/DateField';
import { colors, minTouchHeight, radius, spacing } from '../src/lib/ui';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [purchase, setPurchase] = useState('');
  const [estShip, setEstShip] = useState('10');
  const [researchPrice, setResearchPrice] = useState('');
  const [place, setPlace] = useState('Mac.Bid');
  const [datePurchased, setDatePurchased] = useState(new Date().toLocaleDateString('en-US'));
  const [notes, setNotes] = useState('');
  // Photos taken/picked before the item exists. They are saved with
  // the item; the item screen uploads them to Drive when it opens.
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const router = useRouter();

  const selPhoto = photos.length === 0 ? 0 : Math.min(photoIndex, photos.length - 1);

  const addPhotos = async (fromCamera: boolean) => {
    const uris = await pickPhotos(fromCamera);
    if (uris.length === 0) return;
    setPhotos((prev) => [...prev, ...uris]);
    setPhotoIndex(photos.length);
  };

  const removeSelectedPhoto = () => {
    setPhotos((prev) => prev.filter((_, i) => i !== selPhoto));
  };

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the item a name first.');
      return;
    }
    const item = addItem({
      name: name.trim(),
      purchase: parseFloat(purchase) || 0,
      estShip: parseFloat(estShip) || 0,
      researchPrice: parseFloat(researchPrice) || 0,
      place: place.trim(),
      datePurchased: datePurchased.trim(),
      notes: notes.trim(),
      photos,
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
      <Text style={styles.label}>Photos</Text>
      {photos.length === 0 ? (
        <Text style={styles.hint}>
          No photos yet — photograph the item now, or add photos later on the item screen.
        </Text>
      ) : (
        <>
          <Image source={{ uri: photos[selPhoto] }} style={styles.largePhoto} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbStrip}
          >
            {photos.map((uri, i) => (
              <Pressable key={`${uri}-${i}`} onPress={() => setPhotoIndex(i)}>
                <Image source={{ uri }} style={[styles.thumb, i === selPhoto && styles.thumbSelected]} />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={removeSelectedPhoto} hitSlop={{ top: 6, bottom: 6 }}>
            <Text style={styles.removeText}>Remove this photo</Text>
          </Pressable>
        </>
      )}
      <View style={styles.photoBtnRow}>
        <Pressable style={styles.photoBtn} onPress={() => void addPhotos(true)}>
          <Text style={styles.photoBtnText}>Take photo</Text>
        </Pressable>
        <Pressable style={styles.photoBtn} onPress={() => void addPhotos(false)}>
          <Text style={styles.photoBtnText}>Add from library</Text>
        </Pressable>
      </View>
      <Text style={styles.label}>Item name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Klymit Static V Sleeping Pad" returnKeyType="next" />
      <Text style={styles.label}>Purchase / winning bid ($)</Text>
      <TextInput style={styles.input} value={purchase} onChangeText={setPurchase} keyboardType="decimal-pad" placeholder="0.00" returnKeyType="next" />
      <Text style={styles.label}>Est. shipping ($)</Text>
      <TextInput style={styles.input} value={estShip} onChangeText={setEstShip} keyboardType="decimal-pad" returnKeyType="next" />
      <Text style={styles.label}>Research price ($) — optional</Text>
      <TextInput style={styles.input} value={researchPrice} onChangeText={setResearchPrice} keyboardType="decimal-pad" placeholder="0.00" returnKeyType="next" />
      <Text style={styles.label}>Place of purchase</Text>
      <TextInput style={styles.input} value={place} onChangeText={setPlace} returnKeyType="next" />
      <View style={styles.field}>
        <DateField label="Date purchased" value={datePurchased} onChange={setDatePurchased} />
      </View>
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
  field: { marginTop: spacing.lg },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
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
  largePhoto: { aspectRatio: 1, borderRadius: radius.md, marginTop: spacing.sm, width: '100%' },
  photoBtn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingVertical: spacing.md,
  },
  photoBtnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  photoBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: '600', marginTop: spacing.sm },
  thumb: { borderRadius: radius.sm, height: 56, width: 56 },
  thumbSelected: { borderColor: colors.primary, borderWidth: 2 },
  thumbStrip: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
