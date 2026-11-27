// The video recap: an event played back as one seamless video. A title card
// over the event photo, then up to 12 photos, each with a slow zoom and
// drift and a small caption (who took it, and when), cross-fading into the
// next, then the RollCal end card. Tap to pause. On iPhone it can be saved
// as a real video file to share (modules/recap-video), made on the phone.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAuth } from '../context/AuthContext';
import { CloseIcon, PlayIcon } from '../components/icons';
import { Button } from '../components/ui';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { canExportRecapVideo, savedRecapUrl, shareRecapVideo } from '../lib/recapExport';
import { loadPreview, loadRecap, RecapData, RecapPic, recapVideoAllowed } from '../lib/recapLoader';
import { FADE_MS, Scene } from '../lib/videoRecap';
import { AppStackParamList } from '../navigation/types';
import { fonts, radii, spacing } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'VideoRecap'>;
type Pic = RecapPic;

const MARK = require('../../assets/icon.png');
const FILM_INK = '#211C19';
const CORAL_LIGHT = '#F0997B';
const WHITE = '#FFFFFF';

// A saved recap plays the event's file; otherwise it's built live.
export default function VideoRecapScreen(props: Props) {
  return props.route.params.savedPath ? <SavedRecapPlayer {...props} /> : <LiveRecap {...props} />;
}

// The event's saved recap (made once, shared by everyone in it).
function SavedRecapPlayer({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    savedRecapUrl(route.params.savedPath!).then((u) => (u ? setUrl(u) : setFailed(true)), () => setFailed(true));
  }, [route.params.savedPath]);
  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      {url ? (
        <SavedVideo url={url} />
      ) : failed ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { paddingHorizontal: spacing.xl }]}>
          <Text style={styles.emptyTitle}>Couldn’t load the recap.</Text>
          <Text style={styles.emptyText}>Check your connection and try again.</Text>
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color={WHITE} />
        </View>
      )}
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close recap"
        style={({ pressed }) => [styles.close, { top: insets.top + spacing.sm }, pressed && { opacity: 0.6 }]}
      >
        <CloseIcon size={22} color={WHITE} />
      </Pressable>
    </View>
  );
}

function SavedVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.play();
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={StyleSheet.absoluteFill} />;
}

function LiveRecap({ navigation, route }: Props) {
  const { eventId, mode = 'highlights' } = route.params;
  const { profile } = useAuth();
  // Video recaps are paid; null while checking.
  const [locked, setLocked] = useState<boolean | null>(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [event, setEvent] = useState<RecapData['event'] | null>(null);
  const [when, setWhen] = useState('');
  const [scenes, setScenes] = useState<Scene<Pic>[] | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Each scene has its own 0 -> 1 value: its fade in and its slow move, on
  // the native thread. When a scene ends its value stays at 1, so it holds
  // its last frame underneath while the next one fades in over it. (One
  // shared value made the old photo snap back to its start for a frame.)
  const values = useRef(new Map<number, Animated.Value>());
  const valueFor = useCallback((i: number) => {
    let v = values.current.get(i);
    if (!v) {
      v = new Animated.Value(0);
      values.current.set(i, v);
    }
    return v;
  }, []);
  const reached = useRef(0);
  const running = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const load = useCallback(async () => {
    try {
      const allowed = await recapVideoAllowed(eventId, profile);
      setLocked(!allowed);
      // Free: a 5-second taste (the title and the first photo, no AI), then
      // the offer. Paid: the whole video.
      const data = allowed ? await loadRecap(eventId, mode) : await loadPreview(eventId, mode);
      setEvent(data.event);
      setWhen(data.when);
      setScenes(data.scenes);
      // Fetch every picture first so nothing pops in half way.
      await Promise.all(
        data.scenes.flatMap((s) =>
          s.kind !== 'end' && s.photo?.uri ? [Image.prefetch(s.photo.uri).catch(() => false)] : []
        )
      );
      setReady(true);
    } catch {
      setFailed(true);
    }
  }, [eventId, mode, profile]);

  useEffect(() => {
    load();
  }, [load]);

  const scene = scenes?.[index] ?? null;
  const prev = index > 0 ? (scenes?.[index - 1] ?? null) : null;
  const atEnd = scene?.kind === 'end';

  // Plays the current scene from where it was left (0 on a new scene).
  const play = useCallback(
    (from: number) => {
      if (!scene) return;
      running.current?.stop();
      const progress = valueFor(index);
      progress.setValue(from);
      const anim = Animated.timing(progress, {
        toValue: 1,
        duration: Math.max(0, scene.ms * (1 - from)),
        easing: Easing.linear,
        useNativeDriver: true,
      });
      running.current = anim;
      anim.start(({ finished }) => {
        if (!finished) return;
        // The end card stays up, with Share video / Watch again.
        if (!scenes || index >= scenes.length - 1) return;
        setIndex(index + 1);
      });
    },
    [scene, scenes, valueFor, index]
  );

  useEffect(() => {
    if (!ready) return;
    reached.current = 0;
    setPaused(false);
    play(0);
    return () => running.current?.stop();
    // A new scene starts from 0; pausing is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, index]);

  const togglePause = () => {
    if (atEnd) return;
    hapticLight();
    if (paused) {
      setPaused(false);
      play(reached.current);
    } else {
      running.current?.stop();
      valueFor(index).stopAnimation((v) => {
        reached.current = v;
      });
      setPaused(true);
    }
  };

  const restart = () => {
    hapticLight();
    running.current?.stop();
    // Fresh values: every scene starts hidden again.
    values.current = new Map();
    if (index === 0) play(0);
    else setIndex(0);
  };

  const close = () => navigation.goBack();

  // Makes the .mp4 on the phone, then opens the share sheet (which also
  // has Save Video).
  const shareVideo = async () => {
    if (!scenes || !event || exporting) return;
    setExporting(true);
    try {
      await shareRecapVideo(eventId, mode, { event, when, scenes }, reduceMotion);
      hapticSuccess();
    } catch {
      Alert.alert('Couldn’t make the video', 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // ---- drawing ----

  const fadeIn = (s: Scene<Pic>, progress: Animated.Value) =>
    progress.interpolate({
      inputRange: [0, Math.min(0.5, FADE_MS / s.ms), 1],
      outputRange: [0, 1, 1],
    });

  const moving = (s: Scene<Pic>, p: Animated.Value) => {
    if (s.kind !== 'photo' || reduceMotion) {
      // The title drifts in very slowly; still when motion is reduced.
      const k = reduceMotion ? 1.04 : p.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1.12] });
      return { transform: [{ scale: k }] };
    }
    const m = s.motion;
    return {
      transform: [
        { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [m.fromX * width, m.toX * width] }) },
        { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [m.fromY * height, m.toY * height] }) },
        { scale: p.interpolate({ inputRange: [0, 1], outputRange: [m.fromScale, m.toScale] }) },
      ],
    };
  };

  const seePlans = () => navigation.replace('Upgrade', { reason: 'recap', eventId });

  // current: false for the scene underneath a cross-fade, which leaves its
  // caption out so two captions never overlap.
  const renderScene = (s: Scene<Pic>, p: Animated.Value, current: boolean) => {
    if (s.kind === 'end' && locked) {
      // The end of the free preview: what the full video gives.
      return (
        <View style={[StyleSheet.absoluteFill, styles.endCard]}>
          <Text style={styles.endTitle}>Like it? Get the whole night.</Text>
          <Text style={[styles.endSub, { textAlign: 'center' }]}>
            The full 15-second to 1-minute video, with captions on every photo, ready to share.
            Comes with Plus or an Event Pass.
          </Text>
        </View>
      );
    }
    if (s.kind === 'end') {
      return (
        <View style={[StyleSheet.absoluteFill, styles.endCard]}>
          <Image source={MARK} style={styles.endMark} />
          <Text style={styles.endTitle} numberOfLines={2}>
            {event?.title}
          </Text>
          <Text style={styles.endSub}>Made with RollCal</Text>
        </View>
      );
    }
    return (
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        {s.photo?.uri ? (
          <Animated.Image
            source={{ uri: s.photo.uri }}
            style={[StyleSheet.absoluteFill, moving(s, p)]}
            resizeMode="cover"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1E1E1E' }]} />
        )}
        {s.kind === 'title' ? (
          <>
            <View style={[StyleSheet.absoluteFill, styles.titleShade]} />
            <View style={[styles.titleBlock, { bottom: insets.bottom + 96 }]}>
              <Text style={styles.kicker}>RECAP</Text>
              <Text style={styles.title} numberOfLines={3}>
                {event?.title}
              </Text>
              {when ? <Text style={styles.when}>{when}</Text> : null}
            </View>
          </>
        ) : current && (s.photo.caption || s.photo.meta) ? (
          <Animated.View
            style={[
              styles.captionBlock,
              { bottom: insets.bottom + 56 },
              // In just after its photo, so it never sits on the last one.
              { opacity: p.interpolate({ inputRange: [0, 0.18, 0.3, 1], outputRange: [0, 0, 1, 1] }) },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.caption} numberOfLines={2}>
              {s.photo.caption ?? s.photo.meta}
            </Text>
            {s.photo.caption && s.photo.meta ? (
              <Text style={styles.captionMeta} numberOfLines={1}>
                {s.photo.meta}
              </Text>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    );
  };

  if (failed || (scenes && scenes.length === 0)) {
    return (
      <View style={[styles.screen, styles.center, { paddingHorizontal: spacing.xl }]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.emptyTitle}>
          {failed ? 'Couldn’t load the recap.' : 'No photos to play yet.'}
        </Text>
        <Text style={styles.emptyText}>
          {failed ? 'Check your connection and try again.' : 'Once photos are in the roll, the recap plays them back.'}
        </Text>
        <View style={{ height: spacing.lg }} />
        <Button title="Close" variant="secondary" onPress={close} />
      </View>
    );
  }

  if (!ready || !scene || !event) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color={WHITE} />
        <Text style={[styles.emptyText, { marginTop: spacing.md }]}>Getting your recap ready…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={togglePause}
        accessibilityRole="button"
        accessibilityLabel={atEnd ? 'Recap finished' : paused ? 'Play' : 'Pause'}
      >
        {/* The scene before (its value held at 1, its last frame) under the
            new one fading in. Keyed by scene, so a photo keeps the same view
            from "now" to "before" and never reloads or jumps. */}
        {(prev ? [index - 1, index] : [index]).map((i) => {
          const s = scenes![i];
          const v = valueFor(i);
          return (
            <Animated.View key={i} style={[StyleSheet.absoluteFill, { opacity: fadeIn(s, v) }]}>
              {renderScene(s, v, i === index)}
            </Animated.View>
          );
        })}
      </Pressable>

      <Pressable
        onPress={close}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close recap"
        style={({ pressed }) => [
          styles.close,
          { top: insets.top + spacing.sm },
          pressed && { opacity: 0.6 },
        ]}
      >
        <CloseIcon size={22} color={WHITE} />
      </Pressable>

      {paused ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <View style={styles.pausedBadge}>
            <PlayIcon size={30} color={WHITE} />
          </View>
        </View>
      ) : null}

      {atEnd && locked ? (
        <View style={[styles.endActions, { bottom: insets.bottom + spacing.lg }]}>
          <Button title="See plans" onPress={seePlans} />
          <Button
            title="Watch again"
            variant="secondary"
            onPress={restart}
            style={{ borderColor: 'rgba(255,255,255,0.6)' }}
            textStyle={{ color: WHITE }}
          />
        </View>
      ) : atEnd ? (
        <View style={[styles.endActions, { bottom: insets.bottom + spacing.lg }]}>
          {canExportRecapVideo ? (
            <Button
              title={exporting ? 'Making your video…' : 'Share video'}
              onPress={shareVideo}
              disabled={exporting}
            />
          ) : null}
          <Button
            title="Watch again"
            variant="secondary"
            onPress={restart}
            disabled={exporting}
            style={{ borderColor: 'rgba(255,255,255,0.6)' }}
            textStyle={{ color: WHITE }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.heading, fontSize: 20, color: WHITE, textAlign: 'center' },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  titleShade: { backgroundColor: 'rgba(0,0,0,0.38)' },
  titleBlock: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  kicker: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    letterSpacing: 2,
    color: CORAL_LIGHT,
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, letterSpacing: -0.8, color: WHITE },
  when: { fontFamily: fonts.bodyMedium, fontSize: 16, color: 'rgba(255,255,255,0.85)', marginTop: spacing.sm },
  captionBlock: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: 2 },
  captionMeta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  caption: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: WHITE,
    // A soft shadow so it reads on any photo, light or dark.
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  endCard: { backgroundColor: FILM_INK, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  endMark: { width: 96, height: 96, borderRadius: 22, marginBottom: spacing.lg },
  endTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: WHITE, textAlign: 'center' },
  endSub: { fontFamily: fonts.bodyMedium, fontSize: 15, color: 'rgba(255,255,255,0.8)', marginTop: spacing.sm },
  close: {
    position: 'absolute',
    right: spacing.md,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedBadge: {
    width: 72,
    height: 72,
    borderRadius: radii.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  endActions: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.sm,
  },
});
