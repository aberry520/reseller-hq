import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { getItem, getSettings, setStatus, updateItem } from '../../src/lib/db';
import { pushItemsToSheetLive } from '../../src/lib/sync';
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
import { colors, minTouchHeight, radius, spacing } from '../../src/lib/ui';
import { appliesMacBidFees } from '../../src/lib/types';
import type { Item } from '../../src/lib/types';

const ALL_STATUSES: Item['status'][] = [
  'Draft',
  'Unlisted',
  'Listed',
  'Sold',
  'Trash',
  'Return',
  'Trash Return',
  'Deleted',
];

const parseMoney = (s: string): number => {
  const v = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

const moneyStr = (n: number): string => (n > 0 ? String(n) : '');

export default function ItemScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [location, setLocation] = useState('');
  const [bgNote, setBgNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [costsNote, setCostsNote] = useState('');
  // Full-screen photo viewer: index into item.photos, null = closed.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Editable money fields, mirroring the spreadsheet columns.
  const [cost, setCost] = useState('');
  const [estShipStr, setEstShipStr] = useState('');
  const [soldStr, setSoldStr] = useState('');
  const [feesStr, setFeesStr] = useState('');
  const [shipStr, setShipStr] = useState('');
  // "Mark as sold" prompt: sold price, fees, shipping, date sold.
  const [soldModalVisible, setSoldModalVisible] = useState(false);
  const [soldDateStr, setSoldDateStr] = useState('');

  // Fill the money fields when a different item is opened.
  useEffect(() => {
    if (!item) return;
    setCost(moneyStr(item.purchase));
    setEstShipStr(moneyStr(item.estShip));
    setSoldStr(moneyStr(item.soldPrice));
    setFeesStr(moneyStr(item.fees));
    setShipStr(moneyStr(item.shipping));
    setSoldDateStr(item.dateSold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const refresh = useCallback(() => {
    if (!id) return;
    const it = getItem(id);
    setItem(it);
    if (it) setLocation(it.location);
  }, [id]);

  useFocusEffect(refresh);

  if (!item) {
    return (
      <View style={[styles.container, styles.notFound, { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.notFoundText}>Item not found: {id}</Text>
      </View>
    );
  }

  const settings = getSettings();
  // Per-item flag (Costs & sale card): when on, a MAC.BID lot's cost is
  // computed from the bid: (bid x 1.15 + $3) x 1.07. When off, the Cost
  // entered on the item is used as-is — the total cost of goods. Not
  // everything comes from MAC.BID, so each item decides for itself.
  const applyMacBid = appliesMacBidFees(item);
  const allIn = applyMacBid ? macBidAllIn(item.purchase) : item.purchase;
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
  // Actual sale numbers, shown instead of the suggested price once the
  // item is sold. Computed live from the stored sold price / fees /
  // shipping so the card is right even before Save costs runs.
  const isSold = item.status === 'Sold';
  const actualProfit = item.soldPrice > 0 ? item.soldPrice - allIn - item.fees - item.shipping : 0;
  const actualMargin = item.soldPrice > 0 ? (actualProfit / item.soldPrice) * 100 : 0;
  const actualRevenue = item.soldPrice > 0 ? item.soldPrice - item.fees - item.shipping : 0;

  // Margin calculator lives on its own screen now (Calculator, from the
  // inventory footer) — it is a generic tool, not tied to this item.

  const takePhoto = async (fromCamera: boolean) => {
    const fn = fromCamera
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;
    const result = await fn({
      mediaTypes: ['images'],
      quality: 0.85,
      // Show the crop screen at capture time, locked to square (1:1) for
      // eBay, so the framing can be adjusted before the photo is saved.
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    // eBay displays best with square (1:1) images. The picker above already
    // shows the square crop screen on the phone; this center-crop is the
    // fallback (web ignores the picker's crop UI) so every photo saved is
    // square either way. If the crop ever fails, keep the original so the
    // photo is never lost.
    let uri = asset.uri;
    try {
      const side = Math.min(asset.width, asset.height);
      const cropped = await ImageManipulator.manipulateAsync(
        asset.uri,
        [
          {
            crop: {
              originX: Math.round((asset.width - side) / 2),
              originY: Math.round((asset.height - side) / 2),
              width: side,
              height: side,
            },
          },
        ],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      uri = cropped.uri;
    } catch {
      // fall through with the original photo
    }
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

  const removePhoto = (uri: string) => {
    Alert.alert('Remove photo?', 'This removes the photo from this item.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const idx = item.photos.indexOf(uri);
          const photos = item.photos.filter((p) => p !== uri);
          // White-bg versions are appended in the same order as photos, so
          // the matching one can only be removed by index when every photo
          // so far produced one (arrays the same length). If some failed,
          // the mapping is unknown, so leave them — except when the last
          // photo goes, the white-bg versions are meaningless too.
          let whiteBgPhotos = item.whiteBgPhotos;
          if (idx >= 0 && item.photos.length === item.whiteBgPhotos.length) {
            whiteBgPhotos = item.whiteBgPhotos.filter((_, i) => i !== idx);
          }
          if (photos.length === 0) whiteBgPhotos = [];
          const next = { ...item, photos, whiteBgPhotos };
          updateItem(item.id, next);
          setItem(next);
        },
      },
    ]);
  };

  const movePhoto = (uri: string, dir: -1 | 1) => {
    const idx = item.photos.indexOf(uri);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= item.photos.length) return;
    const photos = [...item.photos];
    [photos[idx], photos[nextIdx]] = [photos[nextIdx], photos[idx]];
    // Keep the white-bg versions in the same order when the arrays line up.
    let whiteBgPhotos = item.whiteBgPhotos;
    if (item.photos.length === item.whiteBgPhotos.length) {
      whiteBgPhotos = [...item.whiteBgPhotos];
      [whiteBgPhotos[idx], whiteBgPhotos[nextIdx]] = [whiteBgPhotos[nextIdx], whiteBgPhotos[idx]];
    }
    const next = { ...item, photos, whiteBgPhotos };
    updateItem(item.id, next);
    setItem(next);
  };

  // Marking an item Sold opens the sold-details prompt (sold price, fees,
  // shipping, date sold) instead of flipping the status on its own. Tapping
  // Sold again on an already-sold item reopens it to edit the details.
  const openSoldModal = () => {
    setSoldStr(moneyStr(item.soldPrice));
    setFeesStr(moneyStr(item.fees));
    setShipStr(moneyStr(item.shipping));
    setSoldDateStr(item.dateSold || new Date().toLocaleDateString('en-US'));
    setSoldModalVisible(true);
  };

  const saveSoldDetails = () => {
    const soldPrice = parseMoney(soldStr);
    const fees = parseMoney(feesStr);
    const shipping = parseMoney(shipStr);
    const dateSold = soldDateStr.trim() || new Date().toLocaleDateString('en-US');
    const profit = soldPrice > 0 ? soldPrice - allIn - fees - shipping : 0;
    const revenue = soldPrice > 0 ? soldPrice - fees - shipping : 0;
    const profitMargin = soldPrice > 0 ? `${((profit / soldPrice) * 100).toFixed(1)}%` : '';
    const next = {
      ...item,
      status: 'Sold' as const,
      dateSold,
      soldPrice,
      fees,
      shipping,
      profit,
      revenue,
      profitMargin,
    };
    setStatus(item.id, 'Sold');
    updateItem(item.id, next);
    setItem(next);
    pushItemsToSheetLive([next]);
    setSoldModalVisible(false);
    setStatusNote(`✓ Sold for ${formatMoney(soldPrice)}`);
    setTimeout(() => setStatusNote(''), 3000);
  };

  const changeStatus = (status: Item['status']) => {
    if (status === 'Sold') {
      openSoldModal();
      return;
    }
    // Persist first, then update local state immediately so the active chip
    // and the status in the header change on the same tap.
    setStatus(item.id, status);
    const today = new Date().toLocaleDateString('en-US');
    const next = {
      ...item,
      status,
      dateListed: status === 'Listed' ? today : item.dateListed,
      dateSold: item.dateSold,
    };
    setItem(next);
    // The sheet updates right away too (and pops up if offline).
    pushItemsToSheetLive([next]);
    setStatusNote(`✓ Marked ${status}`);
    setTimeout(() => setStatusNote(''), 3000);
  };

  const saveCosts = () => {
    const purchase = parseMoney(cost);
    const estShip = parseMoney(estShipStr);
    const soldPrice = parseMoney(soldStr);
    const fees = parseMoney(feesStr);
    const shipping = parseMoney(shipStr);
    const costBasis = applyMacBid ? macBidAllIn(purchase) : purchase;
    const profit = soldPrice > 0 ? soldPrice - costBasis - fees - shipping : 0;
    const revenue = soldPrice;
    const profitMargin = soldPrice > 0 ? `${((profit / soldPrice) * 100).toFixed(1)}%` : '';
    const next = {
      ...item,
      purchase,
      estShip,
      soldPrice,
      fees,
      shipping,
      profit,
      revenue,
      profitMargin,
      dateSold: soldDateStr.trim(),
    };
    updateItem(item.id, next);
    setItem(next);
    pushItemsToSheetLive([next]);
    setCostsNote('✓ Costs saved');
    setTimeout(() => setCostsNote(''), 3000);
  };

  const saveLocation = () => {
    updateItem(item.id, { location });
    pushItemsToSheetLive([{ ...item, location }]);
    Alert.alert('Saved', `Location set to "${location || '(blank)'}"`);
  };

  const confirmDelete = () => {
    Alert.alert(
      'Remove item?',
      `${item.name} will be marked Deleted in the app and the sheet. It will be hidden from the app, but you can restore it from the Inventory filter (Deleted) or by changing its status in the sheet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setStatus(item.id, 'Deleted');
            router.replace('/');
            // The Deleted status goes to the sheet right away too (and
            // pops up if offline). An app-only item has no sheet row to
            // update, so it is skipped inside pushItemsToSheetLive.
            pushItemsToSheetLive([{ ...item, status: 'Deleted' }]);
          },
        },
      ],
    );
  };

  // Restore a Deleted item: back to Draft (it needs a look before it is
  // listed again), and the status goes to the sheet right away. The
  // status chips above can pick a different status instead.
  const restoreItem = () => {
    setStatus(item.id, 'Draft');
    setStatusNote('✓ Restored as Draft.');
    pushItemsToSheetLive([{ ...item, status: 'Draft' }]);
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{cleanName(item.name)}</Text>
      <Text style={styles.meta}>
        {item.id} · {item.status} · {item.place || 'no source'} · bought{' '}
        {item.datePurchased || '—'}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {isSold ? 'Sold' : 'Pricing (30% margin target, 13.6% eBay fee)'}
        </Text>
        {isSold ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>
                Sold for{item.dateSold ? ` · ${item.dateSold}` : ''}
              </Text>
              <Text style={styles.heroPrice}>{formatMoney(item.soldPrice)}</Text>
              <Text
                style={[
                  styles.pill,
                  actualProfit >= 0 ? styles.pillPass : styles.pillFail,
                ]}
              >
                Profit {formatMoney(actualProfit)} · margin {actualMargin.toFixed(1)}%
              </Text>
            </View>
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>{applyMacBid ? 'Cost (all-in)' : 'Cost'}</Text>
                <Text style={styles.tileValue}>{formatMoney(allIn)}</Text>
                {applyMacBid && <Text style={styles.tileSub}>bid {formatMoney(item.purchase)}</Text>}
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Fees paid</Text>
                <Text style={styles.tileValue}>{formatMoney(item.fees)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Shipping paid</Text>
                <Text style={styles.tileValue}>{formatMoney(item.shipping)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Revenue</Text>
                <Text style={styles.tileValue}>{formatMoney(actualRevenue)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Profit</Text>
                <Text style={styles.tileValue}>{formatMoney(actualProfit)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Margin</Text>
                <Text style={styles.tileValue}>{actualMargin.toFixed(1)}%</Text>
              </View>
            </View>
            <Pressable style={styles.btn} onPress={openSoldModal}>
              <Text style={styles.btnText}>Edit sold details</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>Suggested eBay price</Text>
              <Text style={styles.heroPrice}>{formatMoney(suggested)}</Text>
              <Text style={[styles.pill, ok ? styles.pillPass : styles.pillFail]}>
                {ok ? '✓ Passes 30% margin' : '✗ Below 30% margin — reprice or skip'}
              </Text>
              <Text style={styles.note}>
                {item.researchPrice > 0
                  ? 'Based on your Research Price'
                  : 'From margin math (cost + shipping + fees)'}
              </Text>
            </View>
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>{applyMacBid ? 'Cost (all-in)' : 'Cost'}</Text>
                <Text style={styles.tileValue}>{formatMoney(allIn)}</Text>
                {applyMacBid && <Text style={styles.tileSub}>bid {formatMoney(item.purchase)}</Text>}
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Est. shipping</Text>
                <Text style={styles.tileValue}>{formatMoney(item.estShip)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Min eBay price</Text>
                <Text style={styles.tileValue}>{formatMoney(minEbay)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Facebook price</Text>
                <Text style={styles.tileValue}>{formatMoney(fb)}</Text>
                <Text style={styles.tileSub}>rounded up to $5</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Profit at suggested</Text>
                <Text style={styles.tileValue}>{formatMoney(profitAtSuggested)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Margin at suggested</Text>
                <Text style={styles.tileValue}>{(marginAtSuggested * 100).toFixed(1)}%</Text>
              </View>
            </View>
            {item.soldPrice > 0 && (
              <Text style={styles.line}>
                Sold for {formatMoney(item.soldPrice)} · actual profit {formatMoney(item.profit)}
                {item.profitMargin ? ` · margin ${item.profitMargin}` : ''}
              </Text>
            )}
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Costs &amp; sale</Text>
        <Text style={styles.note}>Same columns as the spreadsheet — edit, then save.</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Bought on MAC.BID — add fees + tax</Text>
          <Switch
            value={applyMacBid}
            onValueChange={(v) => {
              const next = { ...item, macBidFees: v };
              updateItem(item.id, next);
              setItem(next);
            }}
          />
        </View>
        <Text style={styles.note}>
          {applyMacBid
            ? 'On: cost = (bid × 1.15 + $3) × 1.07.'
            : 'Off: the cost you enter is the total cost of goods, no fees or tax added.'}
        </Text>
        <View style={styles.moneyGrid}>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>
              {applyMacBid ? 'Bid (MAC.BID)' : 'Total cost of goods'}
            </Text>
            <TextInput
              style={styles.input}
              value={cost}
              onChangeText={setCost}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Est. shipping</Text>
            <TextInput
              style={styles.input}
              value={estShipStr}
              onChangeText={setEstShipStr}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Sold price</Text>
            <TextInput
              style={styles.input}
              value={soldStr}
              onChangeText={setSoldStr}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Fees paid</Text>
            <TextInput
              style={styles.input}
              value={feesStr}
              onChangeText={setFeesStr}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Shipping paid</Text>
            <TextInput
              style={styles.input}
              value={shipStr}
              onChangeText={setShipStr}
              keyboardType="decimal-pad"
              placeholder="0.00"
              returnKeyType="done"
            />
          </View>
          <View style={styles.moneyField}>
            <Text style={styles.fieldLabel}>Date sold</Text>
            <TextInput
              style={styles.input}
              value={soldDateStr}
              onChangeText={setSoldDateStr}
              placeholder="M/D/YYYY"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
            />
          </View>
        </View>
        <Pressable style={styles.btn} onPress={saveCosts}>
          <Text style={styles.btnText}>Save costs</Text>
        </Pressable>
        {costsNote !== '' && <Text style={[styles.note, styles.pass]}>{costsNote}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Photos ({item.photos.length})</Text>
        <Text style={styles.note}>Photos are cropped square (1:1) for eBay — adjust the crop when you take one.</Text>
        {item.photos.length === 0 && <Text style={styles.line}>No photos yet.</Text>}
        {item.photos.map((uri, i) => (
          <View key={uri} style={styles.photoWrap}>
            <Pressable onPress={() => setViewerIndex(i)} accessibilityLabel="Open photo full screen">
              <Image source={{ uri }} style={styles.photo} />
            </Pressable>
            <Pressable
              style={styles.removeBtn}
              onPress={() => removePhoto(uri)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Remove photo"
            >
              <Text style={styles.removeBtnText}>✕</Text>
            </Pressable>
            <View style={styles.photoControls}>
              <Text style={styles.photoLabel}>
                {i === 0 ? 'Cover photo' : `Photo ${i + 1} of ${item.photos.length}`}
              </Text>
              <View style={styles.moveRow}>
                <Pressable
                  style={[styles.moveBtn, i === 0 && styles.moveBtnDisabled]}
                  disabled={i === 0}
                  onPress={() => movePhoto(uri, -1)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Text style={styles.moveBtnText}>↑ Up</Text>
                </Pressable>
                <Pressable
                  style={[styles.moveBtn, i === item.photos.length - 1 && styles.moveBtnDisabled]}
                  disabled={i === item.photos.length - 1}
                  onPress={() => movePhoto(uri, 1)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Text style={styles.moveBtnText}>↓ Down</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
        {item.whiteBgPhotos.length > 0 && (
          <Text style={styles.line}>White-bg versions: {item.whiteBgPhotos.length}</Text>
        )}
        {bgNote !== '' && <Text style={styles.note}>{bgNote}</Text>}
        {busy && <Text style={styles.note}>Removing background…</Text>}
        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={() => void takePhoto(true)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Text style={styles.btnText}>Take photo</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => void takePhoto(false)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
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
          returnKeyType="done"
        />
        <Pressable style={styles.btn} onPress={saveLocation}>
          <Text style={styles.btnText}>Save location</Text>
        </Pressable>
        {item.notes ? <Text style={styles.line}>Notes: {item.notes}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status — {item.status}</Text>
        <View style={styles.statusRow}>
          {ALL_STATUSES.map((s) => (
            <Pressable
              key={s}
              style={[styles.statusChip, item.status === s && styles.statusChipActive]}
              onPress={() => changeStatus(s)}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Text
                style={[styles.statusChipText, item.status === s && styles.statusChipTextActive]}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
        {(item.dateListed !== '' || item.dateSold !== '') && (
          <Text style={styles.note}>
            {item.dateListed !== '' ? `Listed ${item.dateListed}` : ''}
            {item.dateListed !== '' && item.dateSold !== '' ? ' · ' : ''}
            {item.dateSold !== '' ? `Sold ${item.dateSold}` : ''}
          </Text>
        )}
        {statusNote !== '' && <Text style={[styles.note, styles.pass]}>{statusNote}</Text>}
        {item.status === 'Deleted' && (
          <Text style={styles.note}>
            This item is deleted — it is hidden from the list and kept in the sheet. Tap Restore
            below (or any status above) to bring it back.
          </Text>
        )}
      </View>

      <Link href={`/listing/${item.id}`} asChild>
        <Pressable style={StyleSheet.flatten([styles.btn, styles.bigBtn])}>
          <Text style={styles.btnText}>Generate listing draft →</Text>
        </Pressable>
      </Link>

      {item.status === 'Deleted' ? (
        <Pressable
          style={StyleSheet.flatten([styles.btn, styles.restoreBtn])}
          onPress={restoreItem}
        >
          <Text style={styles.btnText}>Restore item</Text>
        </Pressable>
      ) : (
        <Pressable
          style={StyleSheet.flatten([styles.btn, styles.deleteBtn])}
          onPress={confirmDelete}
        >
          <Text style={styles.btnText}>Remove item</Text>
        </Pressable>
      )}
    </ScrollView>

    <Modal
      visible={viewerIndex !== null}
      animationType="fade"
      onRequestClose={() => setViewerIndex(null)}
    >
      <View style={styles.viewer}>
        <View style={[styles.viewerTop, { paddingTop: insets.top + spacing.sm }]}>
          <Text style={styles.viewerCount}>
            {viewerIndex !== null ? `${viewerIndex + 1} of ${item.photos.length}` : ''}
          </Text>
          <Pressable
            style={styles.viewerClose}
            onPress={() => setViewerIndex(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Close photo"
          >
            <Text style={styles.viewerCloseText}>✕</Text>
          </Pressable>
        </View>
        {viewerIndex !== null && (
          <Image
            source={{ uri: item.photos[viewerIndex] }}
            style={styles.viewerImage}
            resizeMode="contain"
          />
        )}
        <View style={[styles.viewerNav, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            style={[styles.viewerNavBtn, viewerIndex === 0 && styles.viewerNavBtnDisabled]}
            disabled={viewerIndex === 0}
            onPress={() => setViewerIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.viewerNavText}>‹ Prev</Text>
          </Pressable>
          <Pressable
            style={[
              styles.viewerNavBtn,
              viewerIndex === item.photos.length - 1 && styles.viewerNavBtnDisabled,
            ]}
            disabled={viewerIndex === item.photos.length - 1}
            onPress={() =>
              setViewerIndex((i) => (i === null ? i : Math.min(item.photos.length - 1, i + 1)))
            }
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.viewerNavText}>Next ›</Text>
          </Pressable>
        </View>
      </View>
    </Modal>

    <Modal
      visible={soldModalVisible}
      animationType="slide"
      onRequestClose={() => setSoldModalVisible(false)}
    >
      <View style={[styles.modalWrap, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.modalTitle}>Mark as sold</Text>
        <Text style={styles.note}>
          Enter what it actually sold for — the item card will show these sold details instead of
          the suggested price.
        </Text>
        <View style={styles.moneyField}>
          <Text style={styles.fieldLabel}>Sold price</Text>
          <TextInput
            style={styles.input}
            value={soldStr}
            onChangeText={setSoldStr}
            keyboardType="decimal-pad"
            placeholder="0.00"
            returnKeyType="done"
            autoFocus
          />
        </View>
        <View style={styles.moneyField}>
          <Text style={styles.fieldLabel}>Fees paid</Text>
          <TextInput
            style={styles.input}
            value={feesStr}
            onChangeText={setFeesStr}
            keyboardType="decimal-pad"
            placeholder="0.00"
            returnKeyType="done"
          />
        </View>
        <View style={styles.moneyField}>
          <Text style={styles.fieldLabel}>Shipping paid</Text>
          <TextInput
            style={styles.input}
            value={shipStr}
            onChangeText={setShipStr}
            keyboardType="decimal-pad"
            placeholder="0.00"
            returnKeyType="done"
          />
        </View>
        <View style={styles.moneyField}>
          <Text style={styles.fieldLabel}>Date sold</Text>
          <TextInput
            style={styles.input}
            value={soldDateStr}
            onChangeText={setSoldDateStr}
            placeholder="M/D/YYYY"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            returnKeyType="done"
          />
        </View>
        {parseMoney(soldStr) > 0 && (
          <Text style={styles.line}>
            Profit {formatMoney(parseMoney(soldStr) - allIn - parseMoney(feesStr) - parseMoney(shipStr))} ·{' '}
            margin{' '}
            {(((parseMoney(soldStr) - allIn - parseMoney(feesStr) - parseMoney(shipStr)) / parseMoney(soldStr)) * 100).toFixed(1)}%
          </Text>
        )}
        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={saveSoldDetails}>
            <Text style={styles.btnText}>Save sold details</Text>
          </Pressable>
          <Pressable
            style={StyleSheet.flatten([styles.btn, styles.cancelBtn])}
            onPress={() => setSoldModalVisible(false)}
          >
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bigBtn: { marginBottom: spacing.sm, marginTop: spacing.lg, paddingVertical: 14 },
  btn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: spacing.sm,
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteBtn: { backgroundColor: colors.danger, marginTop: spacing.lg },
  restoreBtn: { backgroundColor: colors.primary, marginTop: spacing.lg },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  container: { backgroundColor: colors.background, flex: 1 },
  hero: { alignItems: 'center', marginBottom: spacing.md },
  heroLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  heroPrice: { color: colors.text, fontSize: 36, fontWeight: '800', lineHeight: 42, marginTop: 2 },
  pill: {
    borderRadius: 999,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.sm,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillPass: { backgroundColor: colors.success, color: '#fff' },
  pillFail: { backgroundColor: colors.danger, color: '#fff' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  tileLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  tileValue: { color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 2 },
  tileSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  moneyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  moneyField: { flexBasis: '47%', flexGrow: 1 },
  fieldLabel: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  switchLabel: { color: colors.text, flex: 1, fontSize: 15, marginRight: spacing.md },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap' },
  statusChip: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: 999,
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: spacing.sm,
    minHeight: minTouchHeight,
    paddingHorizontal: 16,
  },
  statusChipActive: { backgroundColor: colors.primary },
  statusChipText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  statusChipTextActive: { color: '#fff' },
  content: { paddingHorizontal: spacing.lg },
  fail: { color: colors.danger, fontWeight: '700' },
  input: {
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    fontSize: 16,
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  line: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 6 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: '700', lineHeight: 28, marginBottom: spacing.sm },
  modalWrap: { backgroundColor: colors.background, flex: 1, paddingHorizontal: spacing.lg },
  cancelBtn: { backgroundColor: colors.muted },
  notFound: { paddingHorizontal: spacing.lg },
  notFoundText: { color: colors.text, fontSize: 16 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  pass: { color: colors.success, fontWeight: '700' },
  photo: { borderRadius: radius.sm, height: 240, width: '100%' },
  photoWrap: { marginTop: spacing.sm, position: 'relative' },
  photoControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  photoLabel: { color: colors.muted, fontSize: 13 },
  moveRow: { flexDirection: 'row', gap: spacing.sm },
  moveBtn: {
    backgroundColor: colors.chip,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  moveBtnDisabled: { opacity: 0.4 },
  moveBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  removeBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 32,
    zIndex: 1,
  },
  removeBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  viewer: { backgroundColor: '#000', flex: 1 },
  viewerTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  viewerCount: { color: '#fff', fontSize: 15, fontWeight: '600' },
  viewerClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  viewerCloseText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },
  viewerImage: { flex: 1, width: '100%' },
  viewerNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  viewerNavBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.lg,
  },
  viewerNavBtnDisabled: { opacity: 0.35 },
  viewerNavText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
