import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
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
import { deletePhotoFromDrive, isSyncConfigured, pushItemsToSheetLive, uploadItemPhotos } from '../../src/lib/sync';
import { cleanName, photoUriAt } from '../../src/lib/listing';
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
import DateField from '../../src/components/DateField';
import { colors, minTouchHeight, radius, spacing } from '../../src/lib/ui';
import { appliesMacBidFees, DEFAULT_EBAY_CONDITION, EBAY_CONDITIONS } from '../../src/lib/types';
import type { Item } from '../../src/lib/types';
import CategoryPicker from '../../src/components/CategoryPicker';
import Dropdown from '../../src/components/Dropdown';
import InfoButton from '../../src/components/InfoButton';
import { Ionicons } from '@expo/vector-icons';
import { ebayCategoryById } from '../../src/lib/ebay-categories';
import type { EbayCategory } from '../../src/lib/ebay-categories';

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

// White-bg versions line up with photos by index ('' = no version yet for
// that photo). Return an array the same length as photos, keeping the
// existing entries (they belong to the first photos, in order) and padding
// the rest with ''. Used whenever photos change so the batch removal can
// tell which photos already have a white-bg version and skip them.
const alignWhiteBg = (photos: string[], whiteBgPhotos: string[]): string[] => {
  const out = new Array<string>(photos.length).fill('');
  for (let i = 0; i < Math.min(photos.length, whiteBgPhotos.length); i++) {
    out[i] = whiteBgPhotos[i];
  }
  return out;
};

export default function ItemScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [location, setLocation] = useState('');
  const [bgNote, setBgNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  // Manual photo upload to Drive: only photos without a URL yet go up.
  const [uploadNote, setUploadNote] = useState('');
  const [uploading, setUploading] = useState(false);
  // eBay draft fields (per item): category ID + condition, used when
  // sending the item to the ebay-draft tab.
  const [ebayCategoryId, setEbayCategoryId] = useState('');
  const [ebayCondition, setEbayCondition] = useState(DEFAULT_EBAY_CONDITION);
  const [detailsNote, setDetailsNote] = useState('');
  const [catPickerVisible, setCatPickerVisible] = useState(false);
  // Details card is collapsible and starts collapsed — the calculator
  // and photos are the everyday flow; details are occasional edits.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const ebayCategory = ebayCategoryById(ebayCategoryId.trim());
  // Full-screen photo viewer: index into item.photos, null = closed.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerListRef = useRef<FlatList<string> | null>(null);
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
    if (it) {
      setLocation(it.location);
      setEbayCategoryId(it.ebayCategoryId ?? '');
      setEbayCondition(it.ebayCondition ?? DEFAULT_EBAY_CONDITION);
    }
  }, [id]);

  useFocusEffect(refresh);

  // Automatic photo upload to Drive. Photos upload on their own — when
  // one is added, after background removal, when a white-bg version
  // replaces the original, and as a catch-up when the item is opened —
  // so there is no Upload button to remember. If an attempt fails, the
  // affected photos keep no URL and the Retry button (shown while any
  // photo lacks a URL) runs this again. Silent when sync is not set up.
  const uploadingRef = useRef(false);
  const autoUpload = async (target: Item, forceIndices?: number[]) => {
    if (uploadingRef.current) return;
    if (!isSyncConfigured()) return;
    if (target.photos.length === 0) return;
    const urls = target.photoUrls ?? [];
    const hasWork =
      target.photos.some((_, i) => !urls[i]) || (forceIndices?.length ?? 0) > 0;
    if (!hasWork) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      // Upload the snapshot we were handed first (forced indices
      // included). Then re-read the item and keep going while photos
      // still lack a URL and the last round made progress — a photo
      // added while an upload was in flight gets picked up here instead
      // of being skipped because the guard turned its own trigger away.
      let totalUploaded = 0;
      let errors: string[] = [];
      let current: Item | null = target;
      let force = forceIndices;
      while (current) {
        const res = await uploadItemPhotos(current, { forceIndices: force });
        force = undefined;
        totalUploaded += res.uploaded;
        errors = res.errors;
        if (res.errors.length > 0 || res.uploaded === 0) break;
        const fresh = getItem(current.id);
        if (!fresh || !fresh.photos.some((_, i) => !(fresh.photoUrls ?? [])[i])) break;
        current = fresh;
      }
      if (errors.length > 0) {
        setUploadNote(
          `Upload failed for ${errors.length} photo${errors.length === 1 ? '' : 's'} — tap Retry upload.`,
        );
      } else if (totalUploaded > 0) {
        setUploadNote(`✓ Uploaded ${totalUploaded} photo${totalUploaded === 1 ? '' : 's'} to Drive.`);
        refresh();
      }
    } catch {
      setUploadNote('Upload failed — tap Retry upload.');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  // Catch-up on open: when a different item is opened and some of its
  // photos have no Drive URL yet (added in a past session, or an upload
  // that failed last time), upload them now. Keyed on the item id only,
  // so it runs once per item opened, not on every photo change.
  useEffect(() => {
    if (!item) return;
    const urls = item.photoUrls ?? [];
    if (item.photos.length > 0 && item.photos.some((_, i) => !urls[i])) {
      void autoUpload(item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Photos to display: one entry per index up to the longer of the local
  // photos and the hosted URLs. Prefers the white-bg local file (fast,
  // works offline on the phone), then the Drive URL (the only copy the
  // web version has — local files only exist on the phone that took
  // them), then the original local file. `uploaded` = this photo has a
  // Drive URL; `hasLocal` = a local file exists (needed for White-bg /
  // Make cover / Remove, which all work on the local file).
  // NOTE: this hook must live BEFORE the `if (!item)` early return below.
  // Hooks run in order every render; a hook after an early return is
  // skipped on the render where item is still null (first load) and runs
  // on the next one — React then throws "Rendered more hooks than during
  // the previous render" and the item screen crashes.
  const displayPhotos = useMemo(() => {
    if (!item) return [] as { uri: string; uploaded: boolean; hasLocal: boolean }[];
    const urls = item.photoUrls ?? [];
    const n = Math.max(item.photos.length, urls.length);
    const out: { uri: string; uploaded: boolean; hasLocal: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        uri: photoUriAt(item, i),
        uploaded: !!urls[i],
        hasLocal: !!item.photos[i],
      });
    }
    return out;
  }, [item]);

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
  // Photos with a local file but no Drive URL yet — these are what the
  // automatic upload still owes (never uploaded, or an attempt failed).
  const pendingUploads = item.photos.filter((_, i) => !(item.photoUrls ?? [])[i]).length;
  // Price calculator: the predictions run off the values currently
  // typed into the calculator (cost + estimated shipping), so they
  // update live as you type — not just after a save.
  const calcCost = parseMoney(cost);
  const calcAllIn = applyMacBid ? macBidAllIn(calcCost) : calcCost;
  const calcEstShip = parseMoney(estShipStr);
  const minEbay = minEbayPrice(calcAllIn, calcEstShip, settings.ebayFeePct, settings.targetMarginPct);
  const suggested = suggestedEbayPrice(
    calcAllIn,
    calcEstShip,
    item.researchPrice,
    settings.ebayFeePct,
    settings.targetMarginPct,
  );
  const fb = facebookPrice(suggested, calcEstShip, settings.ebayFeePct);
  const marginAtSuggested = ebayMargin(suggested, calcAllIn, calcEstShip, settings.ebayFeePct);
  const profitAtSuggested = ebayProfit(suggested, calcAllIn, calcEstShip, settings.ebayFeePct);
  const ok = passesMargin(suggested, calcAllIn, calcEstShip, settings.ebayFeePct, settings.targetMarginPct);
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
    const next = {
      ...item,
      photos: [...item.photos, uri],
      // Keep the white-bg array the same length as the photos, aligned by
      // index ('' = no white-bg version yet for that photo). Otherwise the
      // next batch removal can't tell which photos already have one and
      // re-processes everything.
      whiteBgPhotos: alignWhiteBg([...item.photos, uri], item.whiteBgPhotos),
    };
    updateItem(item.id, next);
    setItem(next);
    // Upload the new photo to Drive automatically.
    void autoUpload(next);
  };

  // Batch background removal: send every photo that does not yet have a
  // white-background version to the server, one at a time, and save each
  // result as it comes back so a partial run is kept. Photos are NOT
  // whitened when taken any more — take all of them first, then press
  // this button once. Skips photos that already have a white-bg version.
  const removeAllBackgrounds = async () => {
    if (busy) return;
    if (!settings.bgRemoverUrl) {
      setBgNote('BG remover not set — set the URL in Settings first.');
      return;
    }
    if (item.photos.length === 0) {
      setBgNote('No photos yet.');
      return;
    }
    // White-bg versions line up with photos by index. Keep the existing
    // entries (they belong to the first photos, in order) and pad the rest
    // with '' (not done yet) so the arrays stay the same length.
    const aligned = alignWhiteBg(item.photos, item.whiteBgPhotos);
    const pending = item.photos
      .map((uri, i) => ({ uri, i }))
      .filter(({ i }) => !aligned[i]);
    if (pending.length === 0) {
      setBgNote('All photos already have a white-background version.');
      setTimeout(() => setBgNote(''), 3000);
      return;
    }
    setBusy(true);
    let done = 0;
    let failed = 0;
    const doneIndices: number[] = [];
    for (const [n, { uri, i }] of pending.entries()) {
      setBgNote(`Removing background… ${n + 1} of ${pending.length}`);
      const bg = await removeBackground(uri, settings.bgRemoverUrl);
      if (bg.ok) {
        aligned[i] = bg.uri;
        done += 1;
        doneIndices.push(i);
        const next = { ...item, whiteBgPhotos: [...aligned] };
        updateItem(item.id, next);
        setItem(next);
      } else {
        failed += 1;
      }
    }
    setBusy(false);
    setBgNote(
      failed === 0
        ? `Backgrounds removed for ${done} photo${done === 1 ? '' : 's'}.`
        : `Removed ${done}, failed ${failed}. Check the server and try again.`,
    );
    setTimeout(() => setBgNote(''), 4000);
    // Upload the new white-bg versions to Drive (re-uploading any photo
    // that was already up, so Drive holds the white-bg version).
    if (doneIndices.length > 0) {
      const latest = getItem(item.id);
      if (latest) void autoUpload(latest, doneIndices);
    }
  };

  const removePhoto = (uri: string, onRemoved?: () => void) => {
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
          // Photo URLs line up with photos by index too — drop the URL for
          // the removed photo so the remaining URLs stay aligned. Capture
          // the removed URL first so its Drive file can be deleted too.
          let photoUrls = item.photoUrls ?? [];
          let removedUrl = '';
          if (idx >= 0 && item.photos.length === photoUrls.length) {
            removedUrl = photoUrls[idx] ?? '';
            photoUrls = photoUrls.filter((_, i) => i !== idx);
          }
          if (photos.length === 0) photoUrls = [];
          const next = { ...item, photos, whiteBgPhotos, photoUrls };
          updateItem(item.id, next);
          setItem(next);
          // Keep the sheet and Drive in step: push the item so the sheet's
          // Photo URLs drops the removed URL, and delete the Drive file so
          // it does not linger as an orphan.
          pushItemsToSheetLive([next]);
          if (removedUrl) void deletePhotoFromDrive(removedUrl);
          onRemoved?.();
        },
      },
    ]);
  };

  // Swap a photo with its white-background version: the white-bg becomes
  // the photo shown (and the cover, if it was first), and the original
  // moves into the white-bg slot, so swapping back is one more tap.
  const swapPhotoBg = (index: number) => {
    const whiteBgPhotos = alignWhiteBg(item.photos, item.whiteBgPhotos);
    const bgUri = whiteBgPhotos[index];
    if (!bgUri) return;
    const photos = [...item.photos];
    [photos[index], whiteBgPhotos[index]] = [whiteBgPhotos[index], photos[index]];
    const next = { ...item, photos, whiteBgPhotos };
    updateItem(item.id, next);
    setItem(next);
    setBgNote('Swapped to the white-background version.');
    setTimeout(() => setBgNote(''), 3000);
  };

  // Save the white-bg version AS the photo, replacing (discarding) the
  // original. Offered when a white-bg version exists for the photo.
  // Unlike swap, this is one-way: afterwards the photo IS the white-bg
  // image and there is no separate version to swap back to. The photo
  // is then re-uploaded so Drive holds the white-bg version as well.
  const replaceOriginalWithBg = (index: number) => {
    const bgUri = alignWhiteBg(item.photos, item.whiteBgPhotos)[index];
    if (!bgUri) return;
    Alert.alert(
      'Replace original photo?',
      'The white-background version becomes the photo and the original is discarded. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            const photos = [...item.photos];
            photos[index] = bgUri;
            const whiteBgPhotos = alignWhiteBg(item.photos, item.whiteBgPhotos);
            whiteBgPhotos[index] = '';
            const next = { ...item, photos, whiteBgPhotos };
            updateItem(item.id, next);
            setItem(next);
            setBgNote('White-background version saved as the photo.');
            setTimeout(() => setBgNote(''), 3000);
            // Re-upload so Drive holds this version as the photo.
            void autoUpload(next, [index]);
          },
        },
      ],
    );
  };

  // White-background button in the viewer: if this photo has no white-bg
  // version yet, make one and swap to it; if it already has one, swap
  // between the two versions.
  const viewerWhiteBg = async (index: number) => {
    if (busy) return;
    if (alignWhiteBg(item.photos, item.whiteBgPhotos)[index]) {
      swapPhotoBg(index);
      return;
    }
    if (!settings.bgRemoverUrl) {
      setBgNote('BG remover not set — set the URL in Settings first.');
      return;
    }
    setBusy(true);
    const bg = await removeBackground(item.photos[index], settings.bgRemoverUrl);
    setBusy(false);
    if (!bg.ok) {
      setBgNote(
        `Background removal failed (${bg.reason}${bg.detail ? `: ${bg.detail}` : ''}) — original kept.`,
      );
      return;
    }
    const whiteBgPhotos = alignWhiteBg(item.photos, item.whiteBgPhotos);
    whiteBgPhotos[index] = bg.uri;
    const withBg = { ...item, whiteBgPhotos };
    updateItem(item.id, withBg);
    setItem(withBg);
    swapPhotoBg(index);
    // Upload the new white-bg version to Drive.
    const latest = getItem(item.id);
    if (latest) void autoUpload(latest, [index]);
  };

  // Make the photo in the viewer the cover (first photo). Its white-bg
  // version moves with it when the arrays line up.
  const makeCover = (index: number) => {
    if (index <= 0) return;
    const photos = [...item.photos];
    const [moved] = photos.splice(index, 1);
    photos.unshift(moved);
    let whiteBgPhotos = item.whiteBgPhotos;
    if (item.photos.length === item.whiteBgPhotos.length) {
      whiteBgPhotos = [...item.whiteBgPhotos];
      const [movedBg] = whiteBgPhotos.splice(index, 1);
      whiteBgPhotos.unshift(movedBg);
    }
    // Photo URLs move with their photo so the URLs stay aligned.
    let photoUrls = item.photoUrls ?? [];
    if (item.photos.length === photoUrls.length) {
      photoUrls = [...photoUrls];
      const [movedUrl] = photoUrls.splice(index, 1);
      photoUrls.unshift(movedUrl);
    }
    const next = { ...item, photos, whiteBgPhotos, photoUrls };
    updateItem(item.id, next);
    setItem(next);
    setViewerIndex(0);
    viewerListRef.current?.scrollToIndex({ index: 0, animated: false });
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

  // Price calculator inputs (cost + estimated shipping) save
  // themselves: this runs when a field loses focus (and when the
  // MAC.BID toggle flips), so the calculator has no Save button. The
  // predictions are computed live from the typed values, so they are
  // already current on screen; this persists them to the item + sheet.
  const commitCalculator = () => {
    const purchase = parseMoney(cost);
    const estShip = parseMoney(estShipStr);
    if (purchase === item.purchase && estShip === item.estShip) return;
    const next = { ...item, purchase, estShip };
    updateItem(item.id, next);
    setItem(next);
    pushItemsToSheetLive([next]);
  };

  // One save for the Details card: location (synced to the sheet) and
  // the eBay fields (app-only, saved locally — the sheet has no columns
  // for them). The status chips in the same card apply immediately, so
  // they are not part of this save.
  const saveDetails = () => {
    const cat = ebayCategoryId.trim();
    const cond = ebayCondition || DEFAULT_EBAY_CONDITION;
    const next = { ...item, location, ebayCategoryId: cat, ebayCondition: cond };
    updateItem(item.id, next);
    setItem(next);
    pushItemsToSheetLive([next]);
    setDetailsNote('✓ Details saved');
    setTimeout(() => setDetailsNote(''), 3000);
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
        <View style={styles.cardHeader}>
          <Text style={styles.cardHeaderTitle}>{isSold ? 'Sale' : 'Price calculator'}</Text>
          <InfoButton
            title={isSold ? 'About this sale' : 'About the price calculator'}
            message={
              isSold
                ? 'Revenue is what the sale brought in after fees and shipping (sold price − fees − shipping). Profit is revenue minus your all-in cost, and margin is profit as a share of the sold price. Tap Edit sale to change the sold price, fees, shipping, or date.'
                : 'Type a cost and an estimated shipping amount and the prices update as you type — they save automatically when you leave a field. Suggested eBay price targets a 30% margin after the 13.6% eBay fee; Min eBay price is break-even on margin; the Facebook price is the suggested price minus shipping and fees, rounded up to the nearest $5. If the item came from MAC.BID, turn on the MAC.BID switch and enter the bid — the all-in cost is (bid × 1.15 + $3) × 1.07.'
            }
          />
        </View>
        {isSold ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>
                Revenue from this sale{item.dateSold ? ` · ${item.dateSold}` : ''}
              </Text>
              <Text style={styles.heroPrice}>{formatMoney(actualRevenue)}</Text>
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
                <Text style={styles.tileLabel}>Sold for</Text>
                <Text style={styles.tileValue}>{formatMoney(item.soldPrice)}</Text>
              </View>
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
                <Text style={styles.tileLabel}>Profit</Text>
                <Text style={styles.tileValue}>{formatMoney(actualProfit)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Margin</Text>
                <Text style={styles.tileValue}>{actualMargin.toFixed(1)}%</Text>
              </View>
            </View>
            <Pressable style={styles.btn} onPress={openSoldModal}>
              <Text style={styles.btnText}>Edit sale</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Bought on MAC.BID — add fees + tax</Text>
              <Switch
                value={applyMacBid}
                onValueChange={(v) => {
                  const next = {
                    ...item,
                    macBidFees: v,
                    purchase: parseMoney(cost),
                    estShip: parseMoney(estShipStr),
                  };
                  updateItem(item.id, next);
                  setItem(next);
                  pushItemsToSheetLive([next]);
                }}
              />
            </View>
            <View style={styles.moneyGrid}>
              <View style={styles.moneyField}>
                <Text style={styles.fieldLabel}>
                  {applyMacBid ? 'Bid (MAC.BID)' : 'Total cost of goods'}
                </Text>
                <TextInput
                  style={styles.input}
                  value={cost}
                  onChangeText={setCost}
                  onBlur={commitCalculator}
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
                  onBlur={commitCalculator}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  returnKeyType="done"
                />
              </View>
            </View>
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
            <Pressable
              style={StyleSheet.flatten([styles.btn, styles.soldBtn])}
              onPress={openSoldModal}
            >
              <Text style={styles.btnText}>Mark as Sold</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardHeaderTitle}>Photos ({displayPhotos.length})</Text>
          <InfoButton
            title="About photos"
            message={
              'Photos are cropped square (1:1) for eBay — adjust the crop when you take one. Take all your photos first, then remove backgrounds for all of them at once. Tap a photo to open it full-screen: swipe between photos, whiten the background, make it the cover, replace the original with the white-bg version, or delete it there.\n\nPhotos upload to Google Drive automatically — the white-bg version when there is one — so they show in the web version and the posting extension can use them. If an upload fails, a Retry button appears in this card.'
            }
          />
        </View>
        {displayPhotos.length === 0 && <Text style={styles.line}>No photos yet.</Text>}
        <View style={styles.photoGrid}>
          {displayPhotos.map((p, i) => (
            <View key={p.uri || `photo-${i}`} style={styles.gridCell}>
              <Pressable onPress={() => setViewerIndex(i)} accessibilityLabel={`Open photo ${i + 1} full screen`}>
                <Image source={{ uri: p.uri }} style={styles.gridThumb} />
              </Pressable>
              {i === 0 && (
                <View style={styles.coverBadge}>
                  <Text style={styles.coverBadgeText}>Cover</Text>
                </View>
              )}
              {alignWhiteBg(item.photos, item.whiteBgPhotos)[i] && (
                <View style={styles.wbBadge}>
                  <Text style={styles.wbBadgeText}>WB</Text>
                </View>
              )}
              {p.uploaded && (
                <View style={[styles.wbBadge, styles.uploadedBadge]}>
                  <Text style={styles.uploadedBadgeText}>↑ Drive</Text>
                </View>
              )}
              {p.hasLocal && (
                <Pressable
                  style={styles.gridRemoveBtn}
                  onPress={() => removePhoto(item.photos[i])}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Remove photo"
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
        {bgNote !== '' && <Text style={styles.note}>{bgNote}</Text>}
        {busy && bgNote === '' && <Text style={styles.note}>Removing background…</Text>}
        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={() => void takePhoto(true)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Text style={styles.btnText}>Take photo</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => void takePhoto(false)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Text style={styles.btnText}>Add from library</Text>
          </Pressable>
        </View>
        {item.photos.length > 0 && (
          <Pressable
            style={[styles.btn, styles.bigBtn, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={() => void removeAllBackgrounds()}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Text style={styles.btnText}>
              {busy ? 'Removing backgrounds…' : 'Remove backgrounds for all photos'}
            </Text>
          </Pressable>
        )}
        {uploading ? (
          <Text style={styles.note}>Uploading photos to Drive…</Text>
        ) : pendingUploads > 0 ? (
          <Pressable
            style={[styles.btn, styles.bigBtn]}
            onPress={() => void autoUpload(item)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Text style={styles.btnText}>
              Retry upload ({pendingUploads} photo{pendingUploads === 1 ? '' : 's'})
            </Text>
          </Pressable>
        ) : item.photos.length > 0 ? (
          <Text style={styles.note}>✓ All photos uploaded to Drive.</Text>
        ) : null}
        {uploadNote !== '' && <Text style={styles.note}>{uploadNote}</Text>}
      </View>

      <View style={styles.card}>
        <Pressable
          style={styles.cardHeader}
          onPress={() => setDetailsOpen((o) => !o)}
          hitSlop={{ top: 6, bottom: 6 }}
        >
          <Text style={styles.cardHeaderTitle}>Details</Text>
          <Ionicons
            name={detailsOpen ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.muted}
          />
        </Pressable>
        {!detailsOpen && (
          <Text style={styles.note}>
            {item.status}
            {item.location ? ` · ${item.location}` : ''}
            {item.dateListed ? ` · listed ${item.dateListed}` : ''}
            {item.dateSold ? ` · sold ${item.dateSold}` : ''}
          </Text>
        )}
        {detailsOpen && (
          <>
            <Text style={styles.label}>Status</Text>
            <Dropdown
              value={item.status}
              options={ALL_STATUSES.filter((s) => s !== 'Sold')}
              onSelect={(v) => changeStatus(v as Item['status'])}
            />
            {isSold && (
              <Text style={styles.note}>
                Sold — edit the sale in the Sale card above, or pick another status here to move
                it back.
              </Text>
            )}
            {(item.dateListed !== '' || item.dateSold !== '') && (
              <Text style={styles.note}>
                {item.dateListed !== '' ? `Listed ${item.dateListed}` : ''}
                {item.dateListed !== '' && item.dateSold !== '' ? ' · ' : ''}
                {item.dateSold !== '' ? `Sold ${item.dateSold}` : ''}
              </Text>
            )}
            {statusNote !== '' && <Text style={[styles.note, styles.pass]}>{statusNote}</Text>}
            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              placeholder="Shelf, bin, garage…"
              value={location}
              onChangeText={setLocation}
              returnKeyType="done"
            />
            {item.notes ? <Text style={styles.line}>Notes: {item.notes}</Text> : null}
            <Text style={styles.label}>eBay category</Text>
            <Pressable
              style={styles.catPick}
              onPress={() => setCatPickerVisible(true)}
              hitSlop={{ top: 4, bottom: 4 }}
            >
              <Text style={styles.catPickText} numberOfLines={2}>
                {ebayCategory ? ebayCategory.path : ebayCategoryId.trim() !== '' ? `ID ${ebayCategoryId.trim()} (not in the 2026 tree)` : 'Tap to search eBay categories'}
              </Text>
              <Text style={styles.catPickId}>
                {ebayCategory ? `ID ${ebayCategory.id}` : ebayCategoryId.trim() !== '' ? 'Tap to search, or type an ID below' : 'Search by keyword, e.g. lawn mower'}
              </Text>
            </Pressable>
            <TextInput
              style={styles.input}
              placeholder="Or type a category ID directly"
              placeholderTextColor={colors.muted}
              value={ebayCategoryId}
              onChangeText={(v) => setEbayCategoryId(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              returnKeyType="done"
            />
            <CategoryPicker
              visible={catPickerVisible}
              initialQuery={cleanName(item.name)}
              onSelect={(cat: EbayCategory) => setEbayCategoryId(cat.id)}
              onClose={() => setCatPickerVisible(false)}
            />
            <Text style={styles.label}>eBay condition</Text>
            <Dropdown
              value={ebayCondition}
              options={[...EBAY_CONDITIONS]}
              onSelect={setEbayCondition}
            />
            <Pressable style={styles.btn} onPress={saveDetails}>
              <Text style={styles.btnText}>Save details</Text>
            </Pressable>
            {detailsNote !== '' && <Text style={[styles.note, styles.pass]}>{detailsNote}</Text>}
            {ebayCategoryId.trim() === '' && (
              <Text style={styles.note}>
                Set a category before sending this item to eBay drafts — eBay requires one.
              </Text>
            )}
            {item.status === 'Deleted' && (
              <Text style={styles.note}>
                This item is deleted — it is hidden from the list and kept in the sheet. Tap
                Restore below (or any status above) to bring it back.
              </Text>
            )}
          </>
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
            {viewerIndex !== null ? `${viewerIndex + 1} of ${displayPhotos.length}` : ''}
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
          <FlatList
            key="viewer-open"
            ref={viewerListRef}
            data={displayPhotos.map((p) => p.uri)}
            keyExtractor={(uri) => uri}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, index) => ({
              length: Dimensions.get('window').width,
              offset: Dimensions.get('window').width * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const w = Dimensions.get('window').width;
              const next = Math.round(e.nativeEvent.contentOffset.x / w);
              if (next >= 0 && next < displayPhotos.length) setViewerIndex(next);
            }}
            renderItem={({ item: uri }) => (
              <Image
                source={{ uri }}
                style={[styles.viewerImage, { width: Dimensions.get('window').width }]}
                resizeMode="contain"
              />
            )}
          />
        )}
        {viewerIndex !== null && (
          <View style={[styles.viewerActions, { paddingBottom: insets.bottom + spacing.md }]}>
            <Pressable
              style={[
                styles.viewerActionBtn,
                (busy || !displayPhotos[viewerIndex]?.hasLocal) && styles.viewerActionBtnDisabled,
              ]}
              disabled={busy || !displayPhotos[viewerIndex]?.hasLocal}
              onPress={() => void viewerWhiteBg(viewerIndex)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.viewerActionText}>
                {alignWhiteBg(item.photos, item.whiteBgPhotos)[viewerIndex]
                  ? 'Swap white-bg'
                  : 'White-bg'}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.viewerActionBtn,
                (viewerIndex === 0 || !displayPhotos[viewerIndex]?.hasLocal) &&
                  styles.viewerActionBtnDisabled,
              ]}
              disabled={viewerIndex === 0 || !displayPhotos[viewerIndex]?.hasLocal}
              onPress={() => makeCover(viewerIndex)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.viewerActionText}>Make cover</Text>
            </Pressable>
            {alignWhiteBg(item.photos, item.whiteBgPhotos)[viewerIndex] ? (
              <Pressable
                style={[
                  styles.viewerActionBtn,
                  !displayPhotos[viewerIndex]?.hasLocal && styles.viewerActionBtnDisabled,
                ]}
                disabled={!displayPhotos[viewerIndex]?.hasLocal}
                onPress={() => replaceOriginalWithBg(viewerIndex)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.viewerActionText}>Replace original</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[
                styles.viewerActionBtn,
                styles.viewerDeleteBtn,
                !displayPhotos[viewerIndex]?.hasLocal && styles.viewerActionBtnDisabled,
              ]}
              disabled={!displayPhotos[viewerIndex]?.hasLocal}
              onPress={() =>
                removePhoto(item.photos[viewerIndex], () => setViewerIndex(null))
              }
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.viewerActionText}>Delete</Text>
            </Pressable>
            <Pressable
              style={[styles.viewerActionBtn, styles.viewerDoneBtn]}
              onPress={() => setViewerIndex(null)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.viewerActionText}>Done</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>

    <Modal
      visible={soldModalVisible}
      animationType="slide"
      onRequestClose={() => setSoldModalVisible(false)}
    >
      <ScrollView
        style={styles.modalWrap}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.modalTitle}>{isSold ? 'Edit sale' : 'Mark as sold'}</Text>
        <Text style={styles.note}>
          Enter what it actually sold for — the item will show the revenue from the sale instead
          of the suggested price.
        </Text>
        <View style={styles.modalField}>
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
        <View style={styles.modalField}>
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
        <View style={styles.modalField}>
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
        <View style={styles.modalField}>
          <DateField label="Date sold" value={soldDateStr} onChange={setSoldDateStr} />
        </View>
        {parseMoney(soldStr) > 0 && (
          <Text style={styles.line}>
            Revenue {formatMoney(parseMoney(soldStr) - parseMoney(feesStr) - parseMoney(shipStr))} ·{' '}
            profit {formatMoney(parseMoney(soldStr) - allIn - parseMoney(feesStr) - parseMoney(shipStr))} ·{' '}
            margin{' '}
            {(((parseMoney(soldStr) - allIn - parseMoney(feesStr) - parseMoney(shipStr)) / parseMoney(soldStr)) * 100).toFixed(1)}%
          </Text>
        )}
        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={saveSoldDetails}>
            <Text style={styles.btnText}>{isSold ? 'Save sale' : 'Mark as Sold'}</Text>
          </Pressable>
          <Pressable
            style={StyleSheet.flatten([styles.btn, styles.cancelBtn])}
            onPress={() => setSoldModalVisible(false)}
          >
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
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
  btnDisabled: { opacity: 0.5 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteBtn: { backgroundColor: colors.danger, marginTop: spacing.lg },
  restoreBtn: { backgroundColor: colors.primary, marginTop: spacing.lg },
  soldBtn: { backgroundColor: '#1a7f37', marginTop: spacing.md, paddingVertical: 14 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardHeaderTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 14, fontWeight: '600', marginBottom: 4, marginTop: spacing.sm },
  catPick: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: minTouchHeight,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  catPickText: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  catPickId: { color: colors.muted, fontSize: 13, marginTop: 2 },
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
  // Plain stacked field for the sold modal — NOT moneyField, whose
  // flexGrow: 1 stretches each field to fill the screen in a column.
  modalField: { marginTop: spacing.md },
  cancelBtn: { backgroundColor: colors.muted },
  notFound: { paddingHorizontal: spacing.lg },
  notFoundText: { color: colors.text, fontSize: 16 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  pass: { color: colors.success, fontWeight: '700' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  gridCell: { aspectRatio: 1, position: 'relative', width: '31%' },
  gridThumb: { borderRadius: radius.sm, height: '100%', width: '100%' },
  coverBadge: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    top: 6,
  },
  coverBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  wbBadge: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 4,
    bottom: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
  },
  wbBadgeText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  // "↑ Drive" badge: sits next to the WB badge (right of it) on photos
  // that have been uploaded to Drive.
  uploadedBadge: {
    backgroundColor: 'rgba(37, 99, 235, 0.9)',
    left: 44,
  },
  uploadedBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  gridRemoveBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 28,
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
  viewerImage: { flex: 1 },
  viewerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  viewerActionBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
  },
  viewerActionBtnDisabled: { opacity: 0.35 },
  viewerActionText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  viewerDoneBtn: { backgroundColor: colors.primary },
  viewerDeleteBtn: { backgroundColor: '#cf222e' },
});
