// DateField — a date input that opens a calendar instead of making the
// user type M/D/YYYY by hand.
//
// - iOS: tapping the field opens a bottom-sheet modal with a full inline
//   calendar and a Done button.
// - Android: tapping opens the native date dialog.
// - Web: renders the native date input inline.
// The value is always an "M/D/YYYY" string, the format the sheet and the
// dashboard date helpers use.

import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDashboardDate, parseDashboardDate } from '../lib/dashboard';
import { colors, minTouchHeight, radius, spacing } from '../lib/ui';

export default function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const date = parseDashboardDate(value) ?? new Date();

  const handleChange = (_event: unknown, selected?: Date) => {
    // Android's native dialog fires once and closes itself.
    if (Platform.OS === 'android') setOpen(false);
    if (selected) onChange(formatDashboardDate(selected));
  };

  // Web gets the native date input directly — no pop-up needed.
  if (Platform.OS === 'web') {
    return (
      <View>
        <Text style={styles.label}>{label}</Text>
        <DateTimePicker value={date} mode="date" onChange={handleChange} />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.input} onPress={() => setOpen(true)}>
        <Text style={styles.inputText}>{value || 'Select a date'}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      {Platform.OS === 'ios' ? (
        <Modal
          visible={open}
          animationType="slide"
          transparent
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.sheet}>
            <View style={[styles.sheetCard, { paddingBottom: insets.bottom + spacing.md }]}>
              <DateTimePicker value={date} mode="date" display="inline" onChange={handleChange} />
              <Pressable style={styles.doneBtn} onPress={() => setOpen(false)}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : (
        open && <DateTimePicker value={date} mode="date" display="default" onChange={handleChange} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chevron: { color: colors.muted, fontSize: 16 },
  doneBtn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    minHeight: minTouchHeight,
    paddingVertical: spacing.md,
  },
  doneText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  input: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
  },
  inputText: { color: colors.text, fontSize: 16 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  sheet: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
});
