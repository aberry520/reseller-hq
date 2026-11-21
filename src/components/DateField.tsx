// DateField — a date input that opens a calendar instead of making the
// user type M/D/YYYY by hand.
//
// - iOS: the native compact date picker — it shows the date as a field,
//   and tapping it opens the system calendar pop-up to pick a date.
//   (The inline calendar rendered inside a custom sheet washed its dates
//   out to nearly invisible, so the native pop-up is used instead.)
// - Android: tapping opens the native date dialog.
// - Web: renders the native date input inline.
// The value is always an "M/D/YYYY" string, the format the sheet and the
// dashboard date helpers use.

import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatDashboardDate, parseDashboardDate } from '../lib/dashboard';
import { minTouchHeight, radius, spacing } from '../lib/ui';
import { useThemedStyles } from '../lib/theme-context';
import type { ThemeColors } from '../lib/themes';

export default function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const styles = useThemedStyles(createStyles);
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

  // iOS: the compact picker is itself the field — tapping it opens the
  // system calendar pop-up. Force the light theme so the dates stay dark
  // on the app's white background.
  if (Platform.OS === 'ios') {
    return (
      <View>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.input}>
          <DateTimePicker
            value={date}
            mode="date"
            display="compact"
            themeVariant="light"
            onChange={handleChange}
          />
        </View>
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
      {open && <DateTimePicker value={date} mode="date" display="default" onChange={handleChange} />}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    chevron: { color: colors.muted, fontSize: 16 },
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
  });
