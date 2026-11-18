// Category picker: search eBay's bundled category tree by keyword and
// pick a leaf category. Shows the full breadcrumb so the user can tell
// same-named categories apart (e.g. "Lawn Mowers" under Home & Garden vs
// a parts category). Only leaf categories are offered — eBay only accepts
// leaf IDs for listings.

import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchEbayCategories, EbayCategory } from '../lib/ebay-categories';
import { colors, minTouchHeight, radius, spacing } from '../lib/ui';

export default function CategoryPicker(props: {
  visible: boolean;
  initialQuery: string;
  onSelect: (cat: EbayCategory) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState(props.initialQuery);
  const results = useMemo(() => searchEbayCategories(query), [query]);

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Search eBay categories</Text>
          <Pressable onPress={props.onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Type a keyword, e.g. lawn mower"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
        />
        <Text style={styles.hint}>
          {query.trim() === ''
            ? 'Type to search 18,000+ eBay categories (2026 tree).'
            : `${results.length} match${results.length === 1 ? '' : 'es'} — tap one to use it.`}
        </Text>
        <FlatList
          data={results}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                props.onSelect(item);
                props.onClose();
              }}
            >
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowPath}>{item.path}</Text>
              <Text style={styles.rowId}>ID {item.id}</Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  close: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  hint: { color: colors.muted, fontSize: 13, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: minTouchHeight,
    paddingHorizontal: 12,
  },
  row: { borderBottomColor: colors.divider, borderBottomWidth: 1, paddingVertical: spacing.sm },
  rowId: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowPath: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
});
