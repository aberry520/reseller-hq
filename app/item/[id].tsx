import { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import QRCode from 'react-native-qrcode-svg';
import { getItem, getSettings, setStatus, updateItem } from '../../src/lib/db';
import { cleanName } from '../../src/lib/listing';
import {
  ebayMargin,
  ebayProfit,
  facebookPrice,
  formatMoney,
  macBidAllIn,
  minEbayPrice,
  passesMargin,
  suggestedEbayPrice,
} from '../../src/lib/pricing';
import { removeBackground } from '../../src/services/bg-remover';
import type { Item } from '../../src/lib/types';

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [location, setLocation] = useState('');
  const [bgNote, setBgNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!id) return;
    const it = getItem(id);
    setItem(it);
    if (it) setLocation(it.location);
  }, [id]);

  useFocusEffect(refresh);

  if (!item) {
    return (
      <View style={styles.container}>
        <Text>Item not found: {id}</Text>
      </View>
    );
  }

  const isMacBid = item.place.toLowerCase().includes('mac');
  // Purchase in the sheet is the winning bid for Mac.Bid lots.
  const allIn = isMacBid ? macBidAllIn(item.purchase) : item.purchase;
  const settings = getSettings();
  const minEbay = minEbayPrice(allIn, item.estShip, settings.ebayFeePct, settings.targetMarginPct);
  const suggested = suggestedEbayPrice(
    allIn,
    item.estShip,
    item.researchPrice,
    settings.ebayFeePct,
    settings.targetMarginPct,
  );
  const fb = facebookPrice(suggested, item.estShip, settings.ebayFeePct);
  const marginAtSuggested = ebayMargin(suggested, allIn, item.estShip, settings.ebayFeePct);
  const profitAtSuggested = ebayProfit(suggested, allIn, item.estShip, settings.ebayFeePct);
  const ok = passesMargin(suggested, allIn, item.estShip, settings.ebayFeePct, settings.targetMarginPct);

  const takePhoto = async (fromCamera: boolean) => {
    const fn = fromCamera
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;
    const result = await fn({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    const next = { ...item, photos: [...item.photos, uri] };
    updateItem(item.id, next);
    setItem(next);
    setBgNote('');
    // Background removal is optional and server-based.
    setBusy(true);
    const bg = await removeBackground(uri, settings.bgRemoverUrl);
    setBusy(false);
    if (bg.ok) {
      const withBg = { ...next, whiteBgPhotos: [...next.whiteBgPhotos, bg.uri] };
      updateItem(item.id, withBg);
      setItem(withBg);
      setBgNote('White-background version saved.');
    } else if (bg.reason === 'not-configured') {
      setBgNote('BG remover not set — original photo kept. Set the URL in Settings to auto-whiten.');
    } else {
      setBgNote(`Background removal failed (${bg.reason}${bg.detail ? `: ${bg.detail}` : ''}) — original kept.`);
    }
  };

  const changeStatus = (status: Item['status']) => {
    setStatus(item.id, status);
    refresh();
  };

  const saveLocation = () => {
    updateItem(item.id, { location });
    Alert.alert('Saved', `Location set to "${location || '(blank)'}"`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{cleanName(item.name)}</Text>
      <Text style={styles.meta}>
        {item.id} · {item.status} · {item.place || 'no source'} · bought{' '}
        {item.datePurchased || '—'}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pricing (30% margin target, 13.6% eBay fee)</Text>
        <Text style={styles.line}>
          Purchase (bid): {formatMoney(item.purchase)}
          {isMacBid ? ` → all-in MAC.BID: ${formatMoney(allIn)}` : ' (not a Mac.Bid lot, no fees added)'}
        </Text>
        <Text style={styles.line}>Est. shipping: {formatMoney(item.estShip)}</Text>
        <Text style={styles.line}>
          Min eBay price (free shipping): {formatMoney(minEbay)}
        </Text>
        <Text style={styles.line}>
          Suggested eBay: {formatMoney(suggested)}
          {item.researchPrice > 0 ? ' (from Research Price)' : ' (from margin math)'}
        </Text>
        <Text style={styles.line}>
          Profit at suggested: {formatMoney(profitAtSuggested)} · margin{' '}
          {(marginAtSuggested * 100).toFixed(1)}%
        </Text>
        <Text style={[styles.line, ok ? styles.pass : styles.fail]}>
          {ok ? '✓ Passes 30% margin' : '✗ Below 30% margin — reprice or skip'}
        </Text>
        <Text style={styles.line}>Facebook price (round up to $5): {formatMoney(fb)}</Text>
        {item.soldPrice > 0 && (
          <Text style={styles.line}>
            Sold for {formatMoney(item.soldPrice)} · sheet profit {formatMoney(item.profit)}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Photos ({item.photos.length})</Text>
        {item.photos.length === 0 && <Text style={styles.line}>No photos yet.</Text>}
        {item.photos.map((uri) => (
          <Image key={uri} source={{ uri }} style={styles.photo} />
        ))}
        {item.whiteBgPhotos.length > 0 && (
          <Text style={styles.line}>White-bg versions: {item.whiteBgPhotos.length}</Text>
        )}
        {bgNote !== '' && <Text style={styles.note}>{bgNote}</Text>}
        {busy && <Text style={styles.note}>Removing background…</Text>}
        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={() => void takePhoto(true)}>
            <Text style={styles.btnText}>Take photo</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => void takePhoto(false)}>
            <Text style={styles.btnText}>Add from library</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Location / tracking</Text>
        <TextInput
          style={styles.input}
          placeholder="Shelf, bin, garage…"
          value={location}
          onChangeText={setLocation}
        />
        <Pressable style={styles.btn} onPress={saveLocation}>
          <Text style={styles.btnText}>Save location</Text>
        </Pressable>
        {item.notes ? <Text style={styles.line}>Notes: {item.notes}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>QR label</Text>
        <QRCode value={item.qrCode} size={160} />
        <Text style={styles.line}>{item.id} · {item.qrCode}</Text>
        <Text style={styles.note}>Scan this with the Scan tab to open this item.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={() => changeStatus('Listed')}>
            <Text style={styles.btnText}>Mark Listed</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => changeStatus('Sold')}>
            <Text style={styles.btnText}>Mark Sold</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => changeStatus('Trash')}>
            <Text style={styles.btnText}>Trash</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => changeStatus('Return')}>
            <Text style={styles.btnText}>Return</Text>
          </Pressable>
        </View>
      </View>

      <Link href={`/listing/${item.id}`} asChild>
        <Pressable style={[styles.btn, styles.bigBtn]}>
          <Text style={styles.btnText}>Generate listing draft →</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bigBtn: { marginBottom: 24, marginTop: 4, paddingVertical: 12 },
  btn: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    marginRight: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap' },
  btnText: { color: '#fff', fontWeight: '700' },
  card: {
    backgroundColor: '#f6f8fa',
    borderRadius: 10,
    marginTop: 12,
    padding: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  container: { backgroundColor: '#fff', flex: 1 },
  content: { padding: 12 },
  fail: { color: '#cf222e', fontWeight: '700' },
  input: {
    backgroundColor: '#fff',
    borderColor: '#d0d7de',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  line: { fontSize: 14, marginTop: 4 },
  meta: { color: '#656d76', fontSize: 13, marginTop: 4 },
  note: { color: '#656d76', fontSize: 13, marginTop: 6 },
  pass: { color: '#1a7f37', fontWeight: '700' },
  photo: { borderRadius: 8, height: 220, marginTop: 8, width: '100%' },
  title: { fontSize: 20, fontWeight: '700' },
});
