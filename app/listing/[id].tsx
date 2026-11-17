import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
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

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [copied, setCopied] = useState('');
  const item = id ? getItem(id) : null;

  if (!item) {
    return (
      <View style={styles.container}>
        <Text>Item not found: {id}</Text>
      </View>
    );
  }

  const settings = getSettings();
  const isMacBid = item.place.toLowerCase().includes('mac');
  const allIn = isMacBid ? macBidAllIn(item.purchase) : item.purchase;
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
    backgroundColor: '#0969da',
    borderRadius: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btnText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  card: {
    backgroundColor: '#f6f8fa',
    borderRadius: 10,
    marginTop: 12,
    padding: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  container: { backgroundColor: '#fff', flex: 1 },
  content: { padding: 12 },
  draft: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  line: { fontSize: 14, marginTop: 4 },
  meta: { color: '#656d76', fontSize: 13, marginTop: 4 },
  note: { color: '#656d76', fontSize: 13, marginTop: 8 },
  title: { fontSize: 20, fontWeight: '700' },
});
