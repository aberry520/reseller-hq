// Dropdown: a tappable field that opens a modal list to pick one value.
// Used instead of rows of chips for single-choice fields (status, eBay
// condition) — one obvious control, however many options there are.

import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { minTouchHeight, radius, spacing } from '../lib/ui';
import { useTheme, useThemedStyles } from '../lib/theme-context';
import type { ThemeColors } from '../lib/themes';

export default function Dropdown(props: {
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={styles.field} onPress={() => setOpen(true)} hitSlop={{ top: 4, bottom: 4 }}>
        <Text style={styles.fieldText} numberOfLines={1}>
          {props.value || props.placeholder || 'Select…'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Choose one</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.close}>Cancel</Text>
            </Pressable>
          </View>
          <FlatList
            data={props.options}
            keyExtractor={(o) => o}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
            renderItem={({ item: option }) => (
              <Pressable
                style={styles.row}
                onPress={() => {
                  props.onSelect(option);
                  setOpen(false);
                }}
              >
                <Text style={[styles.rowText, option === props.value && styles.rowTextActive]}>
                  {option}
                </Text>
                {option === props.value && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    close: { color: colors.primary, fontSize: 16, fontWeight: '600' },
    container: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.lg },
    field: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: minTouchHeight,
      paddingHorizontal: 12,
    },
    fieldText: { color: colors.text, flex: 1, fontSize: 16 },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.divider,
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: minTouchHeight,
      paddingVertical: spacing.sm,
    },
    rowText: { color: colors.text, fontSize: 16 },
    rowTextActive: { color: colors.primary, fontWeight: '700' },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  });
