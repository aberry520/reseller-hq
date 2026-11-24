// Tools — the helpers, in one place: margin calculator, QR scanner, QR labels.
// Tap a row to open that tool. Inventory and Settings live in their own tabs.

import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { minTouchHeight, radius, spacing } from '../../src/lib/ui';
import { useTheme, useThemedStyles } from '../../src/lib/theme-context';
import type { ThemeColors } from '../../src/lib/themes';

type Tool = {
  href: '/calculator' | '/scan' | '/labels' | '/mark-labeled' | '/sync' | '/expenses' | '/ebay-drafts';
  icon: 'calculator-outline' | 'scan-outline' | 'pricetag-outline' | 'checkmark-done-outline' | 'sync-outline' | 'receipt-outline' | 'bag-outline';
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
    href: '/mark-labeled',
    icon: 'checkmark-done-outline',
    title: 'Mark as labeled',
    desc: 'Enter a location, then scan QR labels — each item is marked labeled and put at that location.',
  },
  {
    href: '/sync',
    icon: 'sync-outline',
    title: 'Sheet sync',
    desc: 'Compare the app with the Inventory sheet and apply only what you approve.',
  },
  {
    href: '/expenses',
    icon: 'receipt-outline',
    title: 'Expenses',
    desc: 'Tape, MacBid fees, payouts — and sync them with the sheet\u2019s Expenses tab.',
  },
  {
    href: '/ebay-drafts',
    icon: 'bag-outline',
    title: 'eBay drafts',
    desc: 'Send items to the ebay-draft tab for eBay bulk upload. Category and condition are set per item.',
  },
];

export default function ToolsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
