// Frame the event cover: the photo under a window the exact shape of the
// cover (COVER_ASPECT). Drag to move, pinch to zoom; what's inside the
// window is what everyone sees at the top of the event and on its card. The
// whole photo still goes in the roll.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../context/ThemeContext';
import {
  COVER_ASPECT,
  CoverCrop,
  clampOffset,
  cropFromTransform,
  minCoverScale,
  transformFromCrop,
} from '../lib/coverCrop';
import { hapticLight } from '../lib/haptics';
import { spacing } from '../theme';

const MAX_ZOOM = 4; // times the smallest zoom that fills the frame
const DIM = 'rgba(0,0,0,0.62)';

type Props = {
  visible: boolean;
  uri: string | null;
  // The photo's size in pixels, when known (a fresh pick); else measured.
  imageWidth?: number;
  imageHeight?: number;
  initialCrop?: CoverCrop | null;
  onCancel: () => void;
  onDone: (crop: CoverCrop) => void;
};

type T = { scale: number; tx: number; ty: number };

export default function CoverCropper({
  visible,
  uri,
  imageWidth,
  imageHeight,
  initialCrop,
  onCancel,
  onDone,
}: Props) {
  const { type } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  // Edge to edge, exactly the size the cover shows at the top of the event
  // page (full width, COVER_ASPECT): what's in the frame is what you get.
  const frameW = screenW;
  const frameH = frameW / COVER_ASPECT;

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [t, setT] = useState<T | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);

  // The photo's pixel size: from the pick, or asked of the image.
  useEffect(() => {
    if (!visible || !uri) return;
    setT(null);
    if (imageWidth && imageHeight) {
      setSize({ w: imageWidth, h: imageHeight });
      return;
    }
    setSize(null);
    Image.getSize(uri, (w, h) => setSize({ w, h }), () => setSize(null));
  }, [visible, uri, imageWidth, imageHeight]);

  // Start where the host left it, or centred at the smallest zoom.
  useEffect(() => {
    if (!size || t) return;
    const min = minCoverScale(size.w, size.h, frameW, frameH);
    if (initialCrop) {
      const s = transformFromCrop(initialCrop, size.w, size.h, frameW);
      const scale = Math.min(Math.max(s.scale, min), min * MAX_ZOOM);
      setT({ scale, ...clampOffset(size.w, size.h, frameW, frameH, scale, s.tx, s.ty) });
    } else {
      setT({
        scale: min,
        tx: (frameW - size.w * min) / 2,
        ty: (frameH - size.h * min) / 2,
      });
    }
  }, [size, t, initialCrop, frameW, frameH]);

  // Gestures work on a copy so the responder always sees the latest values.
  const live = useRef<{ t: T | null; size: typeof size }>({ t: null, size: null });
  live.current = { t, size };
  const start = useRef<{ t: T; touches: number; midX: number; midY: number; dist: number } | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = null;
        },
        onPanResponderMove: (e) => {
          const cur = live.current;
          if (!cur.t || !cur.size) return;
          const touches = e.nativeEvent.touches;
          const n = Math.min(touches.length, 2);
          if (n === 0) return;
          const midX = n === 2 ? (touches[0].locationX + touches[1].locationX) / 2 : touches[0].locationX;
          const midY = n === 2 ? (touches[0].locationY + touches[1].locationY) / 2 : touches[0].locationY;
          const dist =
            n === 2
              ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY)
              : 0;
          // A finger added or lifted: start again from here.
          if (!start.current || start.current.touches !== n) {
            start.current = { t: cur.t, touches: n, midX, midY, dist };
            return;
          }
          const s0 = start.current;
          const min = minCoverScale(cur.size.w, cur.size.h, frameW, frameH);
          const scale =
            n === 2 && s0.dist > 0
              ? Math.min(Math.max(s0.t.scale * (dist / s0.dist), min), min * MAX_ZOOM)
              : s0.t.scale;
          const k = scale / s0.t.scale;
          // Keep the point under the fingers still while zooming, then move
          // with them.
          const tx = s0.midX - (s0.midX - s0.t.tx) * k + (midX - s0.midX);
          const ty = s0.midY - (s0.midY - s0.t.ty) * k + (midY - s0.midY);
          setT({ scale, ...clampOffset(cur.size.w, cur.size.h, frameW, frameH, scale, tx, ty) });
        },
        onPanResponderRelease: () => {
          start.current = null;
        },
        onPanResponderTerminate: () => {
          start.current = null;
        },
      }),
    [frameW, frameH]
  );

  const onArea = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  };

  const done = () => {
    if (!size || !t) return;
    hapticLight();
    onDone(cropFromTransform(size.w, size.h, frameW, frameH, t.scale, t.tx, t.ty));
  };

  // The frame sits in the middle of the area; the photo is drawn relative
  // to it, and dimmed bands cover what falls outside.
  const frameLeft = area ? (area.w - frameW) / 2 : 0;
  const frameTop = area ? (area.h - frameH) / 2 : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Light clock and battery on the dark screen. */}
        <StatusBar style="light" />
        <View style={styles.bar}>
          <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button" style={styles.barButton}>
            <Text style={[type.body, styles.barText]}>Cancel</Text>
          </Pressable>
          <Text style={[type.button, styles.title]}>Frame your cover</Text>
          <Pressable
            onPress={done}
            disabled={!t}
            hitSlop={12}
            accessibilityRole="button"
            style={[styles.barButton, styles.doneButton, !t && { opacity: 0.4 }]}
          >
            <Text style={[type.button, styles.doneText]}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.area} onLayout={onArea} {...responder.panHandlers}>
          {uri && size && t && area ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image
                source={{ uri }}
                style={{
                  position: 'absolute',
                  left: frameLeft + t.tx,
                  top: frameTop + t.ty,
                  width: size.w * t.scale,
                  height: size.h * t.scale,
                }}
                resizeMode="stretch"
              />
              <View style={[styles.dim, { top: 0, left: 0, right: 0, height: frameTop }]} />
              <View style={[styles.dim, { top: frameTop + frameH, left: 0, right: 0, bottom: 0 }]} />
              <View style={[styles.dim, { top: frameTop, left: 0, width: frameLeft, height: frameH }]} />
              <View style={[styles.dim, { top: frameTop, right: 0, width: frameLeft, height: frameH }]} />
              <View
                style={[styles.frame, { left: frameLeft, top: frameTop, width: frameW, height: frameH }]}
              />
            </View>
          ) : null}
        </View>

        <Text style={[type.caption, styles.hint]}>
          Drag to move, pinch to zoom. This is how the cover looks on the event.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0a09' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  barButton: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  barText: { color: '#efe9dd' },
  title: { color: '#efe9dd' },
  doneButton: { alignItems: 'flex-end' },
  doneText: { color: '#f0997b' },
  area: { flex: 1, overflow: 'hidden' },
  dim: { position: 'absolute', backgroundColor: DIM },
  frame: {
    position: 'absolute',
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  hint: {
    color: 'rgba(239,233,221,0.7)',
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
});
