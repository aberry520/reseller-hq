import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { getItem, getSettings } from '../../src/lib/db';
import { cleanName, ebayDraftText, ebayTitle, facebookDraftText, facebookTitle } from '../../src/lib/listing';
import {
  facebookPrice,
  formatMoney,
  macBidAllIn,
  suggestedEbayPrice,
} from '../../src/lib/pricing';
import { getEbayStatus } from '../../src/services/ebay';
import { appliesMacBidFees } from '../../src/lib/types';
import { colors, minTouchHeight, radius, spacing } from '../../src/lib/ui';

export default function ListingScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [copied, setCopied] = useState('');
  const item = id ? getItem(id) : null;

  if (!item) {
    return (
      <View style={[styles.container, styles.notFound, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.notFoundText}>Item not found: {id}</Text>
      </View>
    );
  }

  const settings = getSettings();
  const applyMacBid = appliesMacBidFees(item);
  const allIn = applyMacBid ? macBidAllIn(item.purchase) : item.purchase;
  const ebayPrice = suggestedEbayPrice(
    allIn,
    item.estShip,
    item.researchPrice,
    settings.ebayFeePct,
    settings.targetMarginPct,
  );
  const fbPrice = facebookPrice(ebayPrice, item.estShip, settings.ebayFeePct);
  const ebayStatus = getEbayStatus();

  const copy = async (label: string, text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(label);
    Alert.alert('Copied', `${label} copied to clipboard.`);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <Text style={styles.title}>{cleanName(item.name)}</Text>
      <Text style={styles.meta}>
        {item.id} · all-in {formatMoney(allIn)} · est. ship {formatMoney(item.estShip)}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>eBay draft</Text>
        <Text style={styles.line}>Title ({ebayTitle(item).length}/80): {ebayTitle(item)}</Text>
        <Text style={styles.line}>
          Price: {formatMoney(ebayPrice)} + FREE shipping
        </Text>
        <Text style={styles.note}>{ebayStatus.message}</Text>
        <Pressable
          style={styles.btn}
          onPress={() => void copy('eBay draft', ebayDraftText(item, ebayPrice))}
        >
          <Text style={styles.btnText}>Copy eBay draft</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Facebook Marketplace draft</Text>
        <Text style={styles.line}>Title: {facebookTitle(item)}</Text>
        <Text style={styles.line}>Price: {formatMoney(fbPrice)} (local pickup, rounded up to $5)</Text>
        <Pressable
          style={styles.btn}
          onPress={() => void copy('Facebook draft', facebookDraftText(item, fbPrice))}
        >
          <Text style={styles.btnText}>Copy Facebook draft</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Description (shared)</Text>
        <Text selectable style={styles.draft}>
          {ebayDraftText(item, ebayPrice)}
        </Text>
      </View>

      {copied !== '' && <Text style={styles.note}>Last copied: {copied}</Text>}
      <Text style={styles.note}>
        v1 generates drafts only — nothing is posted to eBay or Facebook from this screen.
      </Text>
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
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  container: { backgroundColor: colors.background, flex: 1 },
  content: { paddingHorizontal: spacing.lg },
  draft: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 6 },
  line: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 6 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  notFound: { paddingHorizontal: spacing.lg },
  notFoundText: { color: colors.text, fontSize: 16 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: '700', lineHeight: 28 },
});
