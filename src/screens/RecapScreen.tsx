// The recap: an event's name and up to six of its photos on one story-sized
// picture (1080×1920) with the RollCal mark, to share or save. The picture
// is drawn at full size and shown shrunk to fit; Share and Save capture the
// full-size drawing (react-native-view-shot).

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Image,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { PlayIcon } from '../components/icons';
import { canExportRecapVideo, loadSavedRecaps, shareRecapVideo } from '../lib/recapExport';
import { useAuth } from '../context/AuthContext';
import { useProPrompt } from '../context/ProPromptContext';
import { loadRecap, loadRecapPhotos, RecapPic, recapVideoAllowed } from '../lib/recapLoader';
import { buildRecapScenes, recapSignature, RecapMode, totalMs } from '../lib/videoRecap';
import { Button, EmptyNote } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { formatDay } from '../lib/dates';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import {
  pickPicturePhotos,
  RECAP_HEIGHT,
  RECAP_MAX_PHOTOS,
  RECAP_WIDTH,
  recapLayout,
} from '../lib/recap';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, palettes, radii, spacing } from '../theme';
import { placeLabel } from '../lib/place';

type Props = NativeStackScreenProps<AppStackParamList, 'Recap'>;

type Pic = RecapPic;

// The recap always uses the light palette, so it looks the same whoever
// shares it, in light mode or dark.
const P = palettes.light;
const MARK = require('../../assets/icon.png');

export default function RecapScreen({ navigation, route }: Props) {
  const { eventId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [event, setEvent] = useState<{
    title: string;
    starts_at: string;
    location: string | null;
    cover_photo_id: string | null;
  } | null>(null);
  const [pics, setPics] = useState<Pic[] | null>(null);
  const [shown, setShown] = useState<Pic[]>([]);
  // Photos whose picture has arrived. By id, not a count: a photo that
  // stays after "Pick other photos" doesn't load (or report) again.
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<'share' | 'save' | 'video' | null>(null);
  // Video first: it's the more fun one. Picture is the still story card.
  const [mode, setMode] = useState<'video' | 'picture'>('video');
  // The video: the highlights (short) or every photo (up to a minute).
  const [videoMode, setVideoMode] = useState<RecapMode>('highlights');
  // Video recaps are paid; null while checking.
  const [videoAllowed, setVideoAllowed] = useState<boolean | null>(null);
  const { profile } = useAuth();
  const { showProPrompt } = useProPrompt();
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<View>(null);

  const load = useCallback(async () => {
    try {
      const [{ event: ev, pics: all }, allowed] = await Promise.all([
        loadRecapPhotos(eventId),
        recapVideoAllowed(eventId, profile),
      ]);
      setEvent(ev);
      setPics(all);
      setVideoAllowed(allowed);
      setLoaded(new Set());
      // The highlights: the event photo, then the most-loved and best-looking.
      setShown(pickPicturePhotos(all, ev.cover_photo_id));
    } catch {
      setFailed(true);
    }
  }, [eventId, profile]);

  useEffect(() => {
    load();
  }, [load]);

  // The canvas in points; times the screen's pixel ratio it's 1080×1920.
  const ratio = PixelRatio.get();
  const canvasW = RECAP_WIDTH / ratio;
  const canvasH = RECAP_HEIGHT / ratio;
  const k = canvasW / RECAP_WIDTH; // recap pixels -> points
  // The preview: as big as fits above the buttons.
  const previewH = Math.min(screenHeight - insets.top - insets.bottom - 320, (screenWidth - 64) * (16 / 9));
  const previewW = previewH * (9 / 16);
  const previewScale = previewW / canvasW;

  const ready = shown.length > 0 && shown.every((p) => !p.uri || loaded.has(p.id));
  const canShuffle = (pics?.filter((p) => p.hasPicture).length ?? 0) > RECAP_MAX_PHOTOS;

  const shuffle = () => {
    if (!pics || !event) return;
    hapticLight();
    setShown(pickPicturePhotos(pics, event.cover_photo_id, Math.random));
  };

  const capture = () =>
    captureRef(canvasRef, {
      format: 'jpg',
      quality: 0.92,
      result: 'tmpfile',
      width: canvasW,
      height: canvasH,
    });

  // The share sheet titles the picture with its file name, and a capture's
  // is random (9DCD13DB-….jpg), so it goes out named after the event.
  const named = async (uri: string) => {
    const base = (event?.title ?? 'RollCal')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 60) || 'RollCal';
    const target = new File(Paths.cache, `${base} recap.jpg`);
    await new File(uri).copy(target, { overwrite: true });
    return target.uri;
  };

  const share = async () => {
    if (!ready || busy) return;
    setBusy('share');
    try {
      const uri = await named(await capture());
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', UTI: 'public.jpeg' });
    } catch {
      Alert.alert('Couldn’t share the recap', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!ready || busy) return;
    setBusy('save');
    try {
      const MediaLibrary = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to save the recap to your camera roll.');
        return;
      }
      const uri = await capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      hapticSuccess();
      Alert.alert('Saved', 'The recap is in your camera roll.');
    } catch {
      Alert.alert('Couldn’t save the recap', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const playVideo = async () => {
    hapticLight();
    // Free: the player shows a 5-second taste, then the offer.
    if (!videoAllowed) return navigation.navigate('VideoRecap', { eventId, mode: videoMode });
    // The event's saved recap when it's still current; otherwise built live.
    // Asked fresh, so one saved a moment ago (by us or anyone) is used.
    const saved = (await loadSavedRecaps(eventId))[videoMode];
    const current = plans.find((p) => p.mode === videoMode)?.signature;
    navigation.navigate('VideoRecap', {
      eventId,
      mode: videoMode,
      savedPath: saved && saved.signature === current ? saved.path : undefined,
    });
  };

  const shareVideo = async () => {
    if (!videoAllowed) return showProPrompt('recap');
    if (busy) return;
    setBusy('video');
    try {
      const [data, reduce] = await Promise.all([
        loadRecap(eventId, videoMode),
        AccessibilityInfo.isReduceMotionEnabled(),
      ]);
      await shareRecapVideo(eventId, videoMode, data, reduce);
      hapticSuccess();
    } catch {
      Alert.alert('Couldn’t make the video', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (failed) {
    return (
      <View style={[styles.screen, { padding: spacing.lg }]}>
        <EmptyNote>Couldn’t load this event’s photos.</EmptyNote>
      </View>
    );
  }
  if (!event || !pics) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (shown.length === 0) {
    return (
      <View style={[styles.screen, { padding: spacing.lg }]}>
        <EmptyNote>Once the event has photos, you can make a recap of them here.</EmptyNote>
      </View>
    );
  }

  const rects = recapLayout(shown.length);
  const people = new Set(pics.map((p) => p.uploader)).size;
  const count = pics.length;
  const coverPic = pics.find((p) => p.id === event.cover_photo_id && p.uri) ?? pics.find((p) => p.uri);
  const coverUri = coverPic?.uri ?? null;
  // Each choice's photo count and length, from the same plan the video uses.
  const plans = (['highlights', 'all'] as const).map((m) => {
    const scenes = buildRecapScenes(pics, event.cover_photo_id, { mode: m });
    const photos = scenes.filter((s) => s.kind !== 'end').length;
    const seconds = Math.round(totalMs(scenes) / 1000);
    return { mode: m, photos, seconds, signature: recapSignature(m, scenes) };
  });
  const chosen = plans.find((p) => p.mode === videoMode) ?? plans[0];
  const s = (n: number) => n * k;
  // Smaller for longer names, so two lines hold them. (Shrink-to-fit
  // misjudged this absolutely placed text and made short names tiny.)
  const titleSize = event.title.length <= 18 ? 76 : event.title.length <= 32 ? 62 : 50;

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.toggleRow}>
        <View style={styles.toggle} accessibilityRole="tablist">
          {(['video', 'picture'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                hapticLight();
                setMode(m);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              style={[styles.toggleOption, mode === m && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, mode === m && { color: colors.onAccent }]}>
                {m === 'video' ? 'Video' : 'Picture'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.previewArea}>
        {mode === 'video' ? (
          <Pressable
            onPress={playVideo}
            accessibilityRole="button"
            accessibilityLabel={`Play the ${event.title} recap`}
            style={({ pressed }) => [
              styles.previewFrame,
              styles.videoFrame,
              { width: previewW, height: previewH },
              pressed && { opacity: 0.9 },
            ]}
          >
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : null}
            <View style={[StyleSheet.absoluteFill, styles.videoShade]} />
            {videoAllowed === false ? (
              <View style={styles.plusTag}>
                <Text style={styles.plusTagText}>PLUS</Text>
              </View>
            ) : null}
            <View style={styles.playBadge}>
              <PlayIcon size={30} color="#FFFFFF" />
            </View>
            <View style={styles.videoTitleBlock}>
              <Text style={styles.videoKicker}>RECAP</Text>
              <Text style={styles.videoTitle} numberOfLines={2}>
                {event.title}
              </Text>
              <Text style={styles.videoMeta} numberOfLines={1}>
                {chosen.photos} {chosen.photos === 1 ? 'photo' : 'photos'} · {chosen.seconds} seconds
              </Text>
            </View>
          </Pressable>
        ) : (
        <View style={[styles.previewFrame, { width: previewW, height: previewH }]}>
          {/* The full-size drawing, shrunk to fit. */}
          <View
            style={{
              position: 'absolute',
              left: (previewW - canvasW) / 2,
              top: (previewH - canvasH) / 2,
              transform: [{ scale: previewScale }],
            }}
          >
            <View
              ref={canvasRef}
              collapsable={false}
              style={{ width: canvasW, height: canvasH, backgroundColor: P.paper }}
            >
              <Text
                style={{
                  position: 'absolute',
                  left: s(72),
                  top: s(150),
                  width: s(936),
                  fontFamily: fonts.bodyMedium,
                  fontSize: s(34),
                  color: P.inkMuted,
                }}
                numberOfLines={1}
              >
                {formatDay(event.starts_at)}
                {event.location ? ` · ${placeLabel(event.location)}` : ''}
              </Text>
              <Text
                style={{
                  position: 'absolute',
                  left: s(72),
                  top: s(200),
                  width: s(936),
                  fontFamily: fonts.display,
                  fontSize: s(titleSize),
                  lineHeight: s(titleSize * 1.16),
                  letterSpacing: s(-1.5),
                  color: P.ink,
                }}
                numberOfLines={2}
              >
                {event.title}
              </Text>

              {shown.map((p, i) => {
                const r = rects[i];
                return (
                  <View
                    key={p.id}
                    style={{
                      position: 'absolute',
                      left: s(r.x),
                      top: s(r.y),
                      width: s(r.width),
                      height: s(r.height),
                      borderRadius: s(16),
                      overflow: 'hidden',
                      backgroundColor: P.line,
                    }}
                  >
                    {p.uri ? (
                      <Image
                        source={{ uri: p.uri }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                        onLoadEnd={() =>
                          setLoaded((prev) => (prev.has(p.id) ? prev : new Set(prev).add(p.id)))
                        }
                      />
                    ) : null}
                  </View>
                );
              })}

              {/* The mark, bottom left; the exposure count, bottom right. */}
              <View
                style={{
                  position: 'absolute',
                  left: s(72),
                  top: s(1700),
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: s(22),
                }}
              >
                <Image
                  source={MARK}
                  style={{ width: s(84), height: s(84), borderRadius: s(18) }}
                />
                <View>
                  <Text style={{ fontFamily: fonts.display, fontSize: s(44), color: P.ink }}>
                    RollCal
                  </Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: s(26), color: P.inkMuted }}>
                    rollcal.app
                  </Text>
                </View>
              </View>
              <View
                style={{
                  position: 'absolute',
                  right: s(72),
                  top: s(1712),
                  alignItems: 'flex-end',
                  gap: s(10),
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: s(10),
                    borderWidth: s(2),
                    borderColor: P.line,
                    backgroundColor: '#ECE9E1',
                    borderRadius: s(10),
                    paddingHorizontal: s(14),
                    paddingVertical: s(6),
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.bodySemiBold,
                      fontSize: s(20),
                      letterSpacing: s(2),
                      color: P.inkMuted,
                    }}
                  >
                    EXP
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.headingMedium,
                      fontSize: s(30),
                      color: P.ink,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {count < 10 ? `0${count}` : count}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.body, fontSize: s(26), color: P.inkMuted }}>
                  {people === 1 ? 'by 1 person' : `by ${people} people`}
                </Text>
              </View>
            </View>
          </View>
          {!ready ? (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}
        </View>
        )}
      </View>

      <View style={styles.actions}>
        {mode === 'video' ? (
          <>
            {/* Highlights or every photo; each shows how long it runs. */}
            <View style={[styles.toggle, styles.choice]} accessibilityRole="radiogroup">
              {plans.map((p) => (
                <Pressable
                  key={p.mode}
                  onPress={() => {
                    hapticLight();
                    setVideoMode(p.mode);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: videoMode === p.mode }}
                  style={[styles.choiceOption, videoMode === p.mode && styles.toggleActive]}
                >
                  <Text style={[styles.toggleText, videoMode === p.mode && { color: colors.onAccent }]}>
                    {p.mode === 'highlights' ? 'Highlights' : 'All photos'} · {p.seconds}s
                  </Text>
                </Pressable>
              ))}
            </View>
            {/* Playing is the preview's own play button; sharing is the one
                main action here. */}
            {canExportRecapVideo ? (
              <Button
                title={busy === 'video' ? 'Making your video…' : 'Share video'}
                onPress={shareVideo}
                disabled={busy !== null}
              />
            ) : null}
          </>
        ) : (
          <>
            <Button
              title={busy === 'share' ? 'Sharing…' : 'Share'}
              onPress={share}
              disabled={!ready || busy !== null}
            />
            <View style={styles.row}>
              <Button
                title={busy === 'save' ? 'Saving…' : 'Save'}
                variant="secondary"
                onPress={save}
                disabled={!ready || busy !== null}
                style={{ flex: 1 }}
              />
              {canShuffle ? (
                <Button
                  title="Shuffle"
                  variant="secondary"
                  onPress={shuffle}
                  disabled={busy !== null}
                  style={{ flex: 1 }}
                />
              ) : null}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    center: { alignItems: 'center', justifyContent: 'center' },
    previewArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // A hairline so the paper-coloured recap stands off the paper-coloured page.
    previewFrame: {
      overflow: 'hidden',
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    actions: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.sm },
    // The same Month/Day switch as the calendar.
    toggleRow: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.md },
    toggle: {
      flexDirection: 'row',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
      backgroundColor: c.card,
      overflow: 'hidden',
    },
    toggleOption: { paddingVertical: 6, paddingHorizontal: spacing.lg, minWidth: 96, alignItems: 'center' },
    toggleActive: { backgroundColor: c.accent },
    choice: { alignSelf: 'stretch', marginBottom: spacing.xs },
    choiceOption: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center' },
    plusTag: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: radii.tag,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    plusTagText: { fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: 1.5, color: '#FFFFFF' },
    toggleText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: c.ink },
    videoFrame: { backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
    videoShade: { backgroundColor: 'rgba(0,0,0,0.35)' },
    playBadge: {
      width: 72,
      height: 72,
      borderRadius: radii.full,
      backgroundColor: 'rgba(0,0,0,0.45)',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.7)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 4,
    },
    videoTitleBlock: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
    videoKicker: { fontFamily: fonts.bodySemiBold, fontSize: 11, letterSpacing: 2, color: '#F0997B', marginBottom: 4 },
    videoTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: '#FFFFFF' },
    videoMeta: { fontFamily: fonts.bodyMedium, fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  });
