// Tools — the helpers, in one place: margin calculator, QR scanner, QR labels.
// Tap a row to open that tool. Inventory and Settings live in their own tabs.

import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, minTouchHeight, radius, spacing } from '../../src/lib/ui';

type Tool = {
  href: '/calculator' | '/scan' | '/labels' | '/sync';
  icon: 'calculator-outline' | 'scan-outline' | 'pricetag-outline' | 'sync-outline';
  title: string;
  desc: string;
};

const TOOLS: Tool[] = [
  {
    href: '/calculator',
    icon: 'calculator-outline',
    title: 'Margin calculator',
    desc: 'Cost, shipping, fee and selling price — margin, revenue and profit.',
  },
  {
    href: '/scan',
    icon: 'scan-outline',
    title: 'Scan QR',
    desc: 'Point the camera at a QR label to open that item.',
  },
  {
    href: '/labels',
    icon: 'pricetag-outline',
    title: 'QR labels',
    desc: 'Print QR labels for your items on the Zebra printer.',
  },
  {
    href: '/sync',
    icon: 'sync-outline',
    title: 'Sheet sync',
    desc: 'Compare the app with the Purchase sheet and apply only what you approve.',
  },
];

export default function ToolsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingBottom: insets.bottom + spacing.xl,
        paddingTop: spacing.md,
      }}
    >
      {TOOLS.map((tool) => (
        <Link key={tool.href} href={tool.href} asChild>
          <Pressable style={styles.row}>
            <View style={styles.iconBox}>
              <Ionicons name={tool.icon} size={26} color={colors.primary} />
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{tool.title}</Text>
              <Text style={styles.rowDesc}>{tool.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: radius.md,
    height: minTouchHeight,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: minTouchHeight,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowDesc: { color: colors.muted, fontSize: 14, lineHeight: 19, marginTop: 2 },
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
});
