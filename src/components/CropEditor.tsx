// Crop editor — a self-contained square (1:1) crop screen for eBay photos.
// Built on expo-image-manipulator (works in Expo Go, no native editor
// dependency). Drag to pan the image under the square frame, use the zoom
// buttons to zoom, rotate with the rotate buttons, then Done to apply the
// crop. Cancel discards everything, including rotations.
//
// Why custom: expo-image-editor was removed — it depends on Recoil, which
// crashes on React 19 (it reads React internals that no longer exist), and
// it also imports a web-only modal that crashes on native. There is no
// drop-in crop UI that works in Expo Go on React 19, so this is built
// directly on expo-image-manipulator.

import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { colors, minTouchHeight, radius, spacing } from '../lib/ui';

export type CropEditorProps = {
  visible: boolean;
  imageUri: string | undefined;
  onClose: () => void;
  onDone: (uri: string) => void;
};

const MAX_ZOOM = 4;

export default function CropEditor({ visible, imageUri, onClose, onDone }: CropEditorProps) {
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [workingUri, setWorkingUri] = useState<string | undefined>(imageUri);
  const [zoom, setZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  // Latest pan/zoom values for the PanResponder (avoids stale closures).
  const gestureRef = useRef({ zoom: 1, translate: { x: 0, y: 0 }, start: { x: 0, y: 0 } });

  // Reset whenever a new image is opened.
  useEffect(() => {
    if (!visible) return;
    setWorkingUri(imageUri);
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
    gestureRef.current = { zoom: 1, translate: { x: 0, y: 0 }, start: { x: 0, y: 0 } };
    setImgSize(null);
    if (!imageUri) return;
    let cancelled = false;
    ImageManipulator.manipulateAsync(imageUri, []).then((r) => {
      if (!cancelled) setImgSize({ width: r.width, height: r.height });
    });
    return () => {
      cancelled = true;
    };
  }, [visible, imageUri]);

  // The square crop frame, centred in the measured image area.
  const frameSize =
    area !== null ? Math.min(area.width, area.height) - spacing.lg : 0;
  const frameLeft = area !== null ? (area.width - frameSize) / 2 : 0;
  const frameTop = area !== null ? (area.height - frameSize) / 2 : 0;
  // Scale so the image covers the frame at zoom 1.
  const baseScale =
    imgSize !== null && frameSize > 0
      ? Math.max(frameSize / imgSize.width, frameSize / imgSize.height)
      : 1;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        gestureRef.current.start = { ...gestureRef.current.translate };
      },
      onPanResponderMove: (_, gestureState) => {
        const next = {
          x: gestureRef.current.start.x + gestureState.dx,
          y: gestureRef.current.start.y + gestureState.dy,
        };
        gestureRef.current.translate = next;
        setTranslate(next);
      },
      onPanResponderRelease: () => {
        gestureRef.current.translate = { ...gestureRef.current.translate };
      },
    }),
  ).current;

  const zoomBy = (factor: number) => {
    const next = Math.max(1, Math.min(MAX_ZOOM, gestureRef.current.zoom * factor));
    gestureRef.current.zoom = next;
    setZoom(next);
  };

  const resetView = () => {
    gestureRef.current.zoom = 1;
    gestureRef.current.translate = { x: 0, y: 0 };
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  };

  const rotate = async (degrees: 90 | -90) => {
    if (!workingUri || busy) return;
    setBusy(true);
    try {
      const result = await ImageManipulator.manipulateAsync(
        workingUri,
        [{ rotate: degrees }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      setWorkingUri(result.uri);
      setImgSize({ width: result.width, height: result.height });
      resetView();
    } finally {
      setBusy(false);
    }
  };

  const applyCrop = async () => {
    if (!workingUri || !imgSize || !area || frameSize <= 0 || busy) return;
    setBusy(true);
    try {
      const scale = baseScale * zoom;
      // Image top-left in the area's coordinates (centred, then panned).
      const imgLeft = (area.width - imgSize.width * scale) / 2 + translate.x;
      const imgTop = (area.height - imgSize.height * scale) / 2 + translate.y;
      // Frame rect mapped back into the image's pixels.
      const cropSize = frameSize / scale;
      let cropX = (frameLeft - imgLeft) / scale;
      let cropY = (frameTop - imgTop) / scale;
      cropX = Math.max(0, Math.min(cropX, imgSize.width - cropSize));
      cropY = Math.max(0, Math.min(cropY, imgSize.height - cropSize));
      const result = await ImageManipulator.manipulateAsync(
        workingUri,
        [
          {
            crop: {
              originX: Math.round(cropX),
              originY: Math.round(cropY),
              width: Math.round(cropSize),
              height: Math.round(cropSize),
            },
          },
        ],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      onDone(result.uri);
    } finally {
      setBusy(false);
    }
  };

  const displayW = imgSize !== null ? imgSize.width * baseScale * zoom : 0;
  const displayH = imgSize !== null ? imgSize.height * baseScale * zoom : 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <Text style={styles.title}>Crop photo</Text>
          <Pressable onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Drag to move, zoom to frame the square, then Done.</Text>
        <View
          style={styles.area}
          onLayout={(e) => setArea(e.nativeEvent.layout)}
          {...panResponder.panHandlers}
        >
          {workingUri && imgSize !== null && area !== null && (
            <>
              <View style={styles.imageCenter}>
                <Image
                  source={{ uri: workingUri }}
                  style={{
                    width: displayW,
                    height: displayH,
                    transform: [{ translateX: translate.x }, { translateY: translate.y }],
                  }}
                  resizeMode="stretch"
                />
              </View>
              {/* Dimmed area outside the crop frame. */}
              <View style={[styles.dim, { left: 0, top: 0, width: area.width, height: frameTop }]} />
              <View
                style={[
                  styles.dim,
                  { left: 0, top: frameTop + frameSize, width: area.width, height: area.height - frameTop - frameSize },
                ]}
              />
              <View
                style={[styles.dim, { left: 0, top: frameTop, width: frameLeft, height: frameSize }]}
              />
              <View
                style={[
                  styles.dim,
                  { left: frameLeft + frameSize, top: frameTop, width: area.width - frameLeft - frameSize, height: frameSize },
                ]}
              />
              <View
                style={[styles.frame, { left: frameLeft, top: frameTop, width: frameSize, height: frameSize }]}
              />
            </>
          )}
        </View>
        <View style={styles.toolbar}>
          <Pressable style={styles.toolBtn} onPress={() => zoomBy(1 / 1.25)} disabled={busy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.toolBtnText}>− Zoom</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => zoomBy(1.25)} disabled={busy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.toolBtnText}>+ Zoom</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => void rotate(-90)} disabled={busy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.toolBtnText}>⟲ Rotate</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => void rotate(90)} disabled={busy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.toolBtnText}>Rotate ⟳</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={resetView} disabled={busy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.toolBtnText}>Reset</Text>
          </Pressable>
        </View>
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.cancelBtn]} onPress={onClose} disabled={busy}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.doneBtn, busy && styles.btnDisabled]}
            onPress={() => void applyCrop()}
            disabled={busy}
          >
            <Text style={styles.btnText}>{busy ? 'Working…' : 'Done'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#000', flex: 1, paddingTop: spacing.lg },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  closeText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: spacing.xs, paddingHorizontal: spacing.lg },
  area: { flex: 1, marginTop: spacing.sm, overflow: 'hidden', position: 'relative' },
  imageCenter: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)', position: 'absolute' },
  frame: { borderColor: '#fff', borderWidth: 2, position: 'absolute' },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  toolBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingHorizontal: spacing.md,
  },
  toolBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  btn: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchHeight,
    paddingVertical: spacing.md,
  },
  cancelBtn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  doneBtn: { backgroundColor: colors.primary },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
