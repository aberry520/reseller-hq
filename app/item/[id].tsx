import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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

// The item's journey across the top of the screen (mockup flow):
// Draft → To List → Listed → Sold. "To List" is the app's Unlisted
// status (blank in the sheet). Off-journey statuses (Trash, Return,
// Trash Return, Deleted) are not steps — they stay available in the
// Details status editor.
const JOURNEY: { status: Item['status']; label: string }[] = [
  { status: 'Draft', label: 'Draft' },
  { status: 'Unlisted', label: 'To List' },
  { status: 'Listed', label: 'Listed' },
  { status: 'Sold', label: 'Sold' },
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
  // The remaining editable sheet fields (Place of Purchase, Date
  // Purchased, Date Listed), edited in the Details card and saved with
  // its Save button.
  const [place, setPlace] = useState('');
  const [datePurchased, setDatePurchased] = useState('');
  const [dateListed, setDateListed] = useState('');
  // Item name editing happens inline in the header (pencil icon).
  const [editingName, setEditingName] = useState(false);
  const [nameText, setNameText] = useState('');
  const ebayCategory = ebayCategoryById(ebayCategoryId.trim());
  // Full-screen photo viewer: index into item.photos, null = closed.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerListRef = useRef<FlatList<string> | null>(null);
  // Which photo the large preview shows (thumbnail strip selection).
  const [photoIndex, setPhotoIndex] = useState(0);
  // Which Details row is expanded for editing, if any (accordion).
  const [openField, setOpenField] = useState<string | null>(null);
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
    setPhotoIndex(0);
    setOpenField(null);
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
      setPlace(it.place);
      setDatePurchased(it.datePurchased);
      setDateListed(it.dateListed);
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
  // Journey stepper position (-1 when the item is in an off-journey
  // status like Trash or Deleted) and the photo the large preview
  // shows (the selected thumbnail, clamped to what exists).
  const journeyIndex = JOURNEY.findIndex((s) => s.status === item.status);
  const selPhoto = displayPhotos.length === 0 ? 0 : Math.min(photoIndex, displayPhotos.length - 1);
  const toggleField = (field: string) =>
    setOpenField((cur) => (cur === field ? null : field));

  // Margin calculator lives on its own screen now (Calculator, from the
  // inventory footer) — it is a generic tool, not tied to this item.

  // Center-crop a picked photo to square (1:1) — eBay displays best
  // with square images. The camera picker already shows a square crop
  // screen; this guarantees the result is square either way, and it is
  // the only crop for library picks (the crop UI can't be shown when
  // several photos are picked at once). If the crop ever fails, keep
  // the original so the photo is never lost.
  const squareCrop = async (asset: ImagePicker.ImagePickerAsset): Promise<string> => {
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
      return cropped.uri;
    } catch {
      return asset.uri;
    }
  };

  const appendPhotos = (uris: string[]) => {
    const firstNew = item.photos.length;
    const photos = [...item.photos, ...uris];
    const next = {
      ...item,
      photos,
      // Keep the white-bg array the same length as the photos, aligned
      // by index ('' = no white-bg version yet for that photo).
      // Otherwise the next batch removal can't tell which photos
      // already have one and re-processes everything.
      whiteBgPhotos: alignWhiteBg(photos, item.whiteBgPhotos),
    };
    updateItem(item.id, next);
    setItem(next);
    // Show the first photo just added in the large preview.
    setPhotoIndex(firstNew);
    // Upload the new photos to Drive automatically.
    void autoUpload(next);
  };

  const takePhoto = async (fromCamera: boolean) => {
    if (fromCamera) {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        // Show the crop screen at capture time, locked to square (1:1)
        // for eBay, so the framing can be adjusted before the photo is
        // saved.
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (result.canceled || !result.assets?.[0]) return;
      appendPhotos([await squareCrop(result.assets[0])]);
      return;
    }
    // Library: pick as many photos as needed in one go — handy when
    // the pictures were taken earlier with the camera app. Each one is
    // center-cropped to square by squareCrop.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const uris: string[] = [];
    for (const asset of result.assets) {
      uris.push(await squareCrop(asset));
    }
    appendPhotos(uris);
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
    setPhotoIndex(0);
    viewerListRef.current?.scrollToIndex({ index: 0, animated: false });
  };

  // Marking an item Sold opens the sold-details prompt (sold price, fees,
  // shipping, date sold) instead of flipping the status on its own. Tapping
  // Sold again on an already-sold item reopens it to edit the details.
  // A fresh sale is pre-filled so the common case is one tap to save:
  // sold price from the list (suggested eBay) price, fees at the standard
  // eBay rate, shipping at the estimate.
  const openSoldModal = () => {
    if (item.soldPrice > 0) {
      setSoldStr(moneyStr(item.soldPrice));
      setFeesStr(moneyStr(item.fees));
      setShipStr(moneyStr(item.shipping));
    } else {
      setSoldStr(moneyStr(suggested));
      setFeesStr(moneyStr(Math.round(suggested * settings.ebayFeePct * 100) / 100));
      setShipStr(moneyStr(item.estShip));
    }
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

  // Undo a sale (marked sold by mistake, or the sale fell through): the
  // item goes back to Listed and the sale figures are cleared, in the
  // app and the sheet.
  const undoSale = () => {
    Alert.alert(
      'Undo this sale?',
      'The item goes back to Listed and the sold price, fees, shipping, and date sold are cleared. This updates the sheet too.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo sale',
          style: 'destructive',
          onPress: () => {
            const next = {
              ...item,
              status: 'Listed' as const,
              soldPrice: 0,
              fees: 0,
              shipping: 0,
              dateSold: '',
              profit: 0,
              revenue: 0,
              profitMargin: '',
            };
            setStatus(item.id, 'Listed');
            updateItem(item.id, next);
            setItem(next);
            pushItemsToSheetLive([next]);
            setStatusNote('✓ Sale undone — back to Listed');
            setTimeout(() => setStatusNote(''), 3000);
          },
        },
      ],
    );
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

  // One save for the Details card: the sheet fields edited there
  // (location, place of purchase, dates) plus the eBay fields
  // (app-only — the sheet has no columns for them). The status
  // dropdown in the same card applies immediately, so it is not part
  // of this save.
  const saveDetails = () => {
    const cat = ebayCategoryId.trim();
    const cond = ebayCondition || DEFAULT_EBAY_CONDITION;
    const next = {
      ...item,
      location,
      place: place.trim(),
      datePurchased: datePurchased.trim(),
      dateListed: dateListed.trim(),
      ebayCategoryId: cat,
      ebayCondition: cond,
    };
    updateItem(item.id, next);
    setItem(next);
    pushItemsToSheetLive([next]);
    setDetailsNote('✓ Details saved');
    setTimeout(() => setDetailsNote(''), 3000);
  };

  // The item name is edited inline in the header (pencil icon) — it is
  // the field most often fixed while taking inventory, so it does not
  // live in the collapsed Details card.
  const startEditName = () => {
    setNameText(item.name);
    setEditingName(true);
  };

  const saveName = () => {
    const name = nameText.trim();
    setEditingName(false);
    if (name === '' || name === item.name) return;
    const next = { ...item, name };
    updateItem(item.id, next);
    setItem(next);
    pushItemsToSheetLive([next]);
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
    <View style={styles.screen}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {editingName ? (
        <View style={styles.nameEditRow}>
          <TextInput
            style={[styles.input, styles.nameEditInput]}
            value={nameText}
            onChangeText={setNameText}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={saveName}
            placeholder="Item name"
            placeholderTextColor={colors.muted}
          />
          <Pressable style={styles.btn} onPress={saveName} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Text style={styles.btnText}>Save</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => setEditingName(false)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.nameRow}>
          <Text style={[styles.title, styles.nameTitle]}>{cleanName(item.name)}</Text>
          <Pressable
            onPress={startEditName}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Edit item name"
          >
            <Ionicons name="create-outline" size={20} color={colors.muted} />
          </Pressable>
        </View>
      )}
      <Text style={styles.meta}>
        {item.id} · {item.status} · {item.place || 'no source'} · bought{' '}
        {item.datePurchased || '—'}
      </Text>

      <View style={styles.stepper}>
        {JOURNEY.map((step, i) => {
          const state =
            journeyIndex === -1 || i > journeyIndex
              ? 'todo'
              : i < journeyIndex
                ? 'done'
                : 'current';
          return (
            <Fragment key={step.status}>
              {i > 0 && (
                <View style={[styles.stepLine, journeyIndex >= i && styles.stepLineDone]} />
              )}
              <Pressable
                style={styles.step}
                onPress={() => changeStatus(step.status)}
                hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                accessibilityLabel={`Move to ${step.label}`}
              >
                <View
                  style={[
                    styles.stepDot,
                    state === 'done' && styles.stepDotDone,
                    state === 'current' && styles.stepDotCurrent,
                  ]}
                >
                  {state === 'done' ? (
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  ) : (
                    <Text style={[styles.stepNum, state === 'current' && styles.stepNumCurrent]}>
                      {i + 1}
                    </Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, state === 'current' && styles.stepLabelCurrent]}>
                  {step.label}
                </Text>
              </Pressable>
            </Fragment>
          );
        })}
      </View>
      {statusNote !== '' && (
        <Text style={[styles.note, styles.pass, styles.statusNoteBar]}>{statusNote}</Text>
      )}

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardHeaderTitle}>Photos ({displayPhotos.length})</Text>
          <InfoButton
            title="About photos"
            message={
              'Photos are cropped square (1:1) for eBay. With the camera, adjust the crop when you take the photo; from the library you can pick several photos at once and each one is center-cropped square automatically. Take all your photos first, then remove backgrounds for all of them at once. The thumbnails switch the large photo; tap the large photo to open it full-screen: swipe between photos, whiten the background, make it the cover, replace the original with the white-bg version, or delete it there.\n\nPhotos upload to Google Drive automatically — the white-bg version when there is one — so they show in the web version and the posting extension can use them. If an upload fails, a Retry button appears in this card.'
            }
          />
        </View>
        {displayPhotos.length === 0 && <Text style={styles.line}>No photos yet.</Text>}
        {displayPhotos.length > 0 && (
          <>
            <View style={styles.largePhotoWrap}>
              <Pressable
                onPress={() => setViewerIndex(selPhoto)}
                accessibilityLabel="Open photo full screen"
              >
                <Image source={{ uri: displayPhotos[selPhoto].uri }} style={styles.largePhoto} />
              </Pressable>
              {selPhoto === 0 && (
                <View style={styles.coverBadge}>
                  <Text style={styles.coverBadgeText}>Cover</Text>
                </View>
              )}
              {alignWhiteBg(item.photos, item.whiteBgPhotos)[selPhoto] && (
                <View style={styles.wbBadge}>
                  <Text style={styles.wbBadgeText}>WB</Text>
                </View>
              )}
              {displayPhotos[selPhoto].uploaded && (
                <View style={[styles.wbBadge, styles.uploadedBadge]}>
                  <Text style={styles.uploadedBadgeText}>↑ Drive</Text>
                </View>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbStrip}
            >
              {displayPhotos.map((p, i) => (
                <Pressable
                  key={p.uri || `photo-${i}`}
                  onPress={() => setPhotoIndex(i)}
                  style={styles.thumbWrap}
                  accessibilityLabel={`Show photo ${i + 1}`}
                >
                  <Image
                    source={{ uri: p.uri }}
                    style={[styles.thumb, i === selPhoto && styles.thumbSelected]}
                  />
                  {alignWhiteBg(item.photos, item.whiteBgPhotos)[i] ? (
                    <View style={styles.thumbBadge}>
                      <Text style={styles.thumbBadgeText}>WB</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}
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
        <View style={styles.cardHeader}>
          <Text style={styles.cardHeaderTitle}>{isSold ? 'Sale' : 'Price calculator'}</Text>
          <InfoButton
            title={isSold ? 'About this sale' : 'About the price calculator'}
            message={
              isSold
                ? 'Revenue is what the sale brought in after fees and shipping (sold price − fees − shipping). Profit is revenue minus your all-in cost, and margin is profit as a share of the sold price. Tap Edit sale in the bar at the bottom to change the sold price, fees, shipping, or date. Undo sale at the bottom of this card sends the item back to Listed and clears the sale.'
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
            <View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Sold for</Text>
                <Text style={styles.statValue}>{formatMoney(item.soldPrice)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>
                  {applyMacBid ? `Cost (all-in · bid ${formatMoney(item.purchase)})` : 'Cost'}
                </Text>
                <Text style={styles.statValue}>{formatMoney(allIn)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Fees paid</Text>
                <Text style={styles.statValue}>{formatMoney(item.fees)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Shipping paid</Text>
                <Text style={styles.statValue}>{formatMoney(item.shipping)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Profit</Text>
                <Text style={styles.statValue}>{formatMoney(actualProfit)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Margin</Text>
                <Text style={styles.statValue}>{actualMargin.toFixed(1)}%</Text>
              </View>
            </View>
            <Pressable style={styles.undoBtn} onPress={undoSale} hitSlop={{ top: 6, bottom: 6 }}>
              <Text style={styles.undoText}>Undo sale</Text>
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
            <View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Min eBay price</Text>
                <Text style={styles.statValue}>{formatMoney(minEbay)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Facebook price (rounded up to $5)</Text>
                <Text style={styles.statValue}>{formatMoney(fb)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Profit at suggested</Text>
                <Text style={styles.statValue}>{formatMoney(profitAtSuggested)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Margin at suggested</Text>
                <Text style={styles.statValue}>{(marginAtSuggested * 100).toFixed(1)}%</Text>
              </View>
            </View>
          </>
        )}
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
            {item.place ? ` · ${item.place}` : ''}
            {item.dateListed ? ` · listed ${item.dateListed}` : ''}
            {item.dateSold ? ` · sold ${item.dateSold}` : ''}
          </Text>
        )}
        {detailsOpen && (
          <>
            <Pressable style={styles.detailRow} onPress={() => toggleField('status')} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.detailLabel}>Status</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{item.status}</Text>
              <Ionicons name={openField === 'status' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </Pressable>
            {openField === 'status' && (
              <View style={styles.detailEditor}>
                {ALL_STATUSES.filter((s) => s !== 'Sold').map((s) => (
                  <Pressable
                    key={s}
                    style={styles.optRow}
                    onPress={() => {
                      changeStatus(s);
                      setOpenField(null);
                    }}
                    hitSlop={{ top: 4, bottom: 4 }}
                  >
                    <Text style={[styles.optText, item.status === s && styles.optTextActive]}>{s}</Text>
                    {item.status === s && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </Pressable>
                ))}
                {isSold && (
                  <Text style={styles.note}>
                    Sold — edit the sale with Edit sale in the bottom bar, or pick another status
                    here to move it back.
                  </Text>
                )}
                <Text style={styles.note}>
                  Sold is not in this list on purpose — use Mark as Sold so the sale details are
                  recorded.
                </Text>
              </View>
            )}
            <Pressable style={styles.detailRow} onPress={() => toggleField('location')} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.detailLabel}>Location</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{location || 'Not set'}</Text>
              <Ionicons name={openField === 'location' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </Pressable>
            {openField === 'location' && (
              <View style={styles.detailEditor}>
                <TextInput
                  style={styles.input}
                  placeholder="Shelf, bin, garage…"
                  value={location}
                  onChangeText={setLocation}
                  returnKeyType="done"
                />
              </View>
            )}
            <Pressable style={styles.detailRow} onPress={() => toggleField('place')} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.detailLabel}>Place of purchase</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{place || 'Not set'}</Text>
              <Ionicons name={openField === 'place' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </Pressable>
            {openField === 'place' && (
              <View style={styles.detailEditor}>
                <TextInput
                  style={styles.input}
                  placeholder="MAC.BID, Goodwill, Facebook…"
                  value={place}
                  onChangeText={setPlace}
                  returnKeyType="done"
                />
              </View>
            )}
            <Pressable style={styles.detailRow} onPress={() => toggleField('datePurchased')} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.detailLabel}>Date purchased</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{datePurchased || 'Not set'}</Text>
              <Ionicons name={openField === 'datePurchased' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </Pressable>
            {openField === 'datePurchased' && (
              <View style={styles.detailEditor}>
                <DateField label="Date purchased" value={datePurchased} onChange={setDatePurchased} />
              </View>
            )}
            <Pressable style={styles.detailRow} onPress={() => toggleField('dateListed')} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.detailLabel}>Date listed</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{dateListed || 'Not set'}</Text>
              <Ionicons name={openField === 'dateListed' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </Pressable>
            {openField === 'dateListed' && (
              <View style={styles.detailEditor}>
                <DateField label="Date listed" value={dateListed} onChange={setDateListed} />
              </View>
            )}
            <Pressable style={styles.detailRow} onPress={() => toggleField('category')} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.detailLabel}>eBay category</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {ebayCategory ? ebayCategory.name : ebayCategoryId.trim() !== '' ? `ID ${ebayCategoryId.trim()}` : 'Not set'}
              </Text>
              <Ionicons name={openField === 'category' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </Pressable>
            {openField === 'category' && (
              <View style={styles.detailEditor}>
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
                {ebayCategoryId.trim() === '' && (
                  <Text style={styles.note}>
                    Set a category before sending this item to eBay drafts — eBay requires one.
                  </Text>
                )}
              </View>
            )}
            <Pressable style={styles.detailRow} onPress={() => toggleField('condition')} hitSlop={{ top: 4, bottom: 4 }}>
              <Text style={styles.detailLabel}>eBay condition</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{ebayCondition}</Text>
              <Ionicons name={openField === 'condition' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </Pressable>
            {openField === 'condition' && (
              <View style={styles.detailEditor}>
                {EBAY_CONDITIONS.map((c) => (
                  <Pressable key={c} style={styles.optRow} onPress={() => setEbayCondition(c)} hitSlop={{ top: 4, bottom: 4 }}>
                    <Text style={[styles.optText, ebayCondition === c && styles.optTextActive]}>{c}</Text>
                    {ebayCondition === c && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </Pressable>
                ))}
              </View>
            )}
            {item.notes ? <Text style={styles.line}>Notes: {item.notes}</Text> : null}
            <Pressable style={styles.btn} onPress={saveDetails}>
              <Text style={styles.btnText}>Save details</Text>
            </Pressable>
            {detailsNote !== '' && <Text style={[styles.note, styles.pass]}>{detailsNote}</Text>}
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

    <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
      {isSold ? (
        <>
          <View style={styles.barInfo}>
            <Text style={styles.barLabel}>Revenue</Text>
            <Text style={styles.barValue}>{formatMoney(actualRevenue)}</Text>
            <Text style={styles.barSub}>
              profit {formatMoney(actualProfit)} · margin {actualMargin.toFixed(1)}%
            </Text>
          </View>
          <Pressable
            style={StyleSheet.flatten([styles.btn, styles.barBtn])}
            onPress={openSoldModal}
          >
            <Text style={styles.btnText}>Edit sale</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.barInfo}>
            <Text style={styles.barLabel}>Projected profit</Text>
            <Text style={styles.barValue}>{formatMoney(profitAtSuggested)}</Text>
            <Text style={styles.barSub}>
              {(marginAtSuggested * 100).toFixed(1)}% margin at the suggested price
            </Text>
          </View>
          <Pressable
            style={StyleSheet.flatten([styles.btn, styles.soldBtn, styles.barBtn])}
            onPress={openSoldModal}
          >
            <Text style={styles.btnText}>Mark as Sold</Text>
          </Pressable>
        </>
      )}
    </View>

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
      transparent
      onRequestClose={() => setSoldModalVisible(false)}
    >
      <View style={styles.sheetBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setSoldModalVisible(false)}
          accessibilityLabel="Close"
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.modalTitle}>{isSold ? 'Edit sale' : 'Mark as sold'}</Text>
        <Text style={styles.note}>
          {isSold
            ? 'Update what it actually sold for.'
            : 'Pre-filled from the list price, fees at the standard eBay rate, and your shipping estimate — adjust anything that differs and save.'}
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
        </View>
      </View>
    </Modal>
    </View>
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
  screen: { backgroundColor: colors.background, flex: 1 },
  stepper: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  step: { alignItems: 'center', width: 60 },
  stepDot: {
    alignItems: 'center',
    backgroundColor: colors.chip,
    borderRadius: 13,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  stepDotDone: { backgroundColor: colors.success },
  stepDotCurrent: { backgroundColor: colors.primary },
  stepNum: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  stepNumCurrent: { color: '#fff' },
  stepLabel: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 4 },
  stepLabelCurrent: { color: colors.text },
  stepLine: { backgroundColor: colors.border, flex: 1, height: 2, marginTop: 13 },
  stepLineDone: { backgroundColor: colors.success },
  statusNoteBar: { textAlign: 'center' },
  largePhotoWrap: { marginTop: spacing.sm, position: 'relative' },
  largePhoto: { aspectRatio: 1, borderRadius: radius.md, width: '100%' },
  thumbStrip: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: { borderRadius: radius.sm, height: 56, width: 56 },
  thumbSelected: { borderColor: colors.primary, borderWidth: 2 },
  thumbBadge: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 3,
    bottom: 3,
    left: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
    position: 'absolute',
  },
  thumbBadgeText: { color: colors.text, fontSize: 8, fontWeight: '700' },
  detailRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: minTouchHeight,
    paddingVertical: 10,
  },
  detailLabel: { color: colors.text, fontSize: 15, fontWeight: '600', width: 128 },
  detailValue: { color: colors.muted, flex: 1, fontSize: 15, marginRight: 6, textAlign: 'right' },
  detailEditor: {
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  optRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingVertical: 6,
  },
  optText: { color: colors.text, fontSize: 15 },
  optTextActive: { color: colors.primary, fontWeight: '700' },
  bottomBar: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  barInfo: { flex: 1, marginRight: spacing.md },
  barLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  barValue: { color: colors.text, fontSize: 20, fontWeight: '800', lineHeight: 24 },
  barSub: { color: colors.muted, fontSize: 12 },
  barBtn: { marginRight: 0, marginTop: 0 },
  undoBtn: { alignItems: 'center', marginTop: spacing.md, paddingVertical: 8 },
  undoText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  sheetBackdrop: { backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '88%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardHeaderTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
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
  // Plain stacked field for the sold modal — NOT moneyField, whose
  // flexGrow: 1 stretches each field to fill the screen in a column.
  modalField: { marginTop: spacing.md },
  cancelBtn: { backgroundColor: colors.muted },
  notFound: { paddingHorizontal: spacing.lg },
  notFoundText: { color: colors.text, fontSize: 16 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  pass: { color: colors.success, fontWeight: '700' },
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
  title: { color: colors.text, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  nameRow: { alignItems: 'flex-start', flexDirection: 'row' },
  nameTitle: { flex: 1, marginRight: spacing.sm },
  nameEditRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  nameEditInput: { flex: 1, fontSize: 17 },
  statRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  statLabel: { color: colors.muted, flex: 1, fontSize: 14, marginRight: spacing.md },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
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
