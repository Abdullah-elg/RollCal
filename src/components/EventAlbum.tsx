// The roll on the event screen: the photo and video grid, the full-screen
// viewer, uploading, saving to the phone, deleting and choosing the cover.
// Photos from blocked people are hidden, and free events show when their
// photos will be deleted.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { File, Paths } from 'expo-file-system';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  GestureResponderEvent,
  Image,
  ImageStyle,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useProPrompt } from '../context/ProPromptContext';
import { useUnread } from '../context/UnreadContext';
import { animateNext } from '../lib/animate';
import { daysLeft, loadPhotoExpiry, PhotoExpiry, WARN_DAYS } from '../lib/expiry';
import { pickRollMedia, uploadBlocker, uploadRollMedia } from '../lib/photos';
import { rollState } from '../lib/roll';
import { hapticLight } from '../lib/haptics';
import { badgeFor, loadReactions, REACTION_NAMES, REACTIONS, ReactionSummary, toggleReaction } from '../lib/reactions';
import { getPhotoReadMap, isRecentMark, previousPhotoMark } from '../lib/unread';
import { loadBlockedIds } from '../lib/safety';
import { supabase } from '../lib/supabase';
import {
  formatBytes,
  loadUploadAllowance,
  nearAllowance,
  overAllowance,
  UploadAllowance,
} from '../lib/uploads';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Event, Photo } from '../types';
import ConfirmDialog from './ConfirmDialog';
import ActionMenuSheet from './ActionMenuSheet';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, MoreIcon, PlayIcon } from './icons';
import ReportSheet from './ReportSheet';
import { Button, EmptyNote } from './ui';
import { guestName } from '../lib/guests';
import { loadAllowed } from '../lib/postPermissions';
import { Allowed, mayPost, POST_BLOCKED_NOTE } from '../lib/postRules';
import { signedLinks, signedUrl } from '../lib/signedUrls';
import InfoTip from './InfoTip';

const BUCKET = 'event-photos';
const GRID_GAP = 2;
// The film border around the photos inside the strip.
const FILM_FRAME = 8;

export type LoadedPhoto = Photo & {
  // Full size, for photos; videos are linked when they play (RollVideo).
  url: string | null;
  // The small preview for the grid: a photo's, or a video's still frame.
  thumbUrl: string | null;
  uploaderName: string;
};

type Props = {
  event: Event;
  isLeader: boolean;
  userId: string;
  refreshSeq: number;
  onPhotosChange?: (photos: LoadedPhoto[]) => void;
  uploadsClosedOverride?: boolean;
  // Host only: reopens a closed roll for 24 hours.
  onReopenRoll?: () => void;
  coverPhotoId?: string | null;
  onSetCoverPhoto?: (photoId: string | null) => void;
  // The event page shows at most this many tiles; past that the last tile
  // says how many more there are and calls onShowAll (the All photos screen).
  previewCount?: number;
  onShowAll?: () => void;
};

type MediaLibraryModule = typeof import('expo-media-library/legacy');

let mediaLibrary: MediaLibraryModule | null | undefined;

function getMediaLibrary(): MediaLibraryModule | null {
  if (mediaLibrary === undefined) {
    try {
      mediaLibrary = require('expo-media-library/legacy') as MediaLibraryModule;
    } catch {
      mediaLibrary = null;
    }
  }
  return mediaLibrary;
}

// Film stock colours: fixed in light and dark mode, it's film.
// The film strip is a darker shade of the page, with sprocket holes in the
// page colour so they look punched through.
type FilmColors = { base: string; hole: string; text: string; textMuted: string; plate: string };
export function filmColors(c: Palette, dark: boolean): FilmColors {
  return dark
    ? { base: '#0A0D0B', hole: c.paper, text: c.ink, textMuted: c.inkMuted, plate: c.card }
    : { base: '#EAE6DB', hole: c.paper, text: c.ink, textMuted: '#565D55', plate: c.card };
}

// A row of sprocket holes along the edge of the film strip.
function Sprockets({ width }: { width: number }) {
  const { colors, mode } = useTheme();
  const hole = filmColors(colors, mode === 'dark').hole;
  const count = Math.max(6, Math.floor(width / 18));
  return (
    <View
      pointerEvents="none"
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        height: 4,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: 6, height: 4, borderRadius: 1.5, backgroundColor: hole }} />
      ))}
    </View>
  );
}

// Photo count styled like a film camera's exposure counter.
function ExposureCounter({ count }: { count: number }) {
  const { colors, mode } = useTheme();
  const FILM = filmColors(colors, mode === 'dark');
  const formatted = count < 10 ? `0${count}` : String(count);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: FILM.plate,
        borderWidth: 1,
        borderColor: FILM.hole,
        borderRadius: radii.tag,
        paddingHorizontal: 6,
        paddingVertical: 2,
        gap: 4,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontFamily: fonts.bodySemiBold,
          letterSpacing: 0.8,
          color: FILM.textMuted,
          textTransform: 'uppercase',
        }}
      >
        EXP
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontFamily: fonts.headingMedium,
          color: FILM.text,
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatted}
      </Text>
    </View>
  );
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Stands in for a thumbnail: videos aren't signed until they're opened.
function VideoTileFace({
  durationMs,
  hasStill = false,
}: {
  durationMs: number | null;
  // A still frame shows underneath: dim it a little instead of covering it.
  hasStill?: boolean;
}) {
  const { colors, mode, type } = useTheme();
  // Dark in either mode, but lifted off the page in dark mode so the tile
  // still reads as a tile.
  const bg = hasStill ? 'rgba(0,0,0,0.22)' : mode === 'dark' ? colors.line : colors.ink;
  const fg = hasStill ? '#FFFFFF' : mode === 'dark' ? colors.ink : colors.paper;

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
      ]}
    >
      <PlayIcon size={28} color={fg} />
      {durationMs != null && (
        <Text
          style={{
            ...type.caption,
            position: 'absolute',
            right: spacing.xs,
            bottom: spacing.xs,
            color: fg,
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatDuration(durationMs)}
        </Text>
      )}
    </View>
  );
}

// Grid tile; new uploads fade in like a print developing.
function DevelopingPhotoItem({
  photo,
  style,
  imageStyle,
  isDeveloping,
  reported,
  reaction,
  isNew,
  onPress,
  children,
}: {
  photo: LoadedPhoto;
  style: StyleProp<ViewStyle>;
  imageStyle: StyleProp<ImageStyle>;
  isDeveloping?: boolean;
  // Reported to you as host and not dealt with yet: outlined in red.
  reported?: boolean;
  // The most-used reaction and the total, for the badge bottom-left.
  reaction?: { emoji: string; total: number } | null;
  // Added by someone else since you last looked: a coral dot top-right.
  isNew?: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const { mode, colors } = useTheme();
  const uri = photo.thumbUrl ?? photo.url;
  const face = (
    <>
      {photo.kind === 'video' ? (
        <VideoTileFace durationMs={photo.duration_ms} hasStill={!!uri} />
      ) : null}
      {reported ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderWidth: 3, borderColor: colors.danger }]}
        />
      ) : null}
      {reaction ? (
        <View
          pointerEvents="none"
          accessible
          accessibilityLabel={`${reaction.total} ${reaction.total === 1 ? 'reaction' : 'reactions'}`}
          style={{
            position: 'absolute',
            left: 4,
            bottom: 4,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: radii.full,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        >
          <Text style={{ fontSize: 11 }}>{reaction.emoji}</Text>
          <Text style={{ fontSize: 11, color: '#FFFFFF', fontFamily: fonts.bodySemiBold }}>
            {reaction.total}
          </Text>
        </View>
      ) : null}
      {isNew ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 5,
            right: 5,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.live,
          }}
        />
      ) : null}
    </>
  );
  const a11y = reported
    ? { accessibilityLabel: `Reported ${photo.kind === 'video' ? 'video' : 'photo'}. Opens the report.` }
    : isNew
      ? { accessibilityLabel: `New ${photo.kind === 'video' ? 'video' : 'photo'}` }
      : {};
  const anim = useRef(new Animated.Value(isDeveloping ? 0 : 1)).current;

  useEffect(() => {
    if (isDeveloping) {
      Animated.timing(anim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [isDeveloping, anim]);

  if (!isDeveloping) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [style, pressed && { transform: [{ scale: 0.97 }] }]}
        {...a11y}
      >
        {uri ? <Image source={{ uri }} style={imageStyle} /> : null}
        {face}
        {children}
      </Pressable>
    );
  }

  // Starts faint and washed out, then deepens to full colour.
  const imageOpacity = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.4, 0.8, 1],
  });

  const washOpacity = anim.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.85, 0.35, 0],
  });

  const washColor = mode === 'dark' ? '#232A26' : '#FFFEFA';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        style,
        { overflow: 'hidden' },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
      {...a11y}
    >
      {uri ? (
        <Animated.Image
          source={{ uri }}
          style={[imageStyle, { opacity: imageOpacity }]}
        />
      ) : null}
      {face}

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: washColor,
            opacity: washOpacity,
          },
        ]}
      />

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: washOpacity }]}
      >
        <BlurView
          intensity={20}
          tint={mode === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {children}
    </Pressable>
  );
}

function RollVideoPlayer({ uri }: { uri: string }) {
  // Released on unmount, so it stops when the page changes or the viewer closes.
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: '100%', height: '100%' }} />;
}

// Signs the video only once its page is showing. Also used by HostReportScreen.
export function RollVideo({ storagePath }: { storagePath: string }) {
  const { colors, type } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    signedUrl(BUCKET, storagePath).then((url) => {
      if (cancelled) return;
      if (url) setUri(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  if (uri) return <RollVideoPlayer uri={uri} />;
  if (failed) return <Text style={[type.caption, { color: colors.inkMuted }]}>Couldn’t load this video.</Text>;
  return <ActivityIndicator color={colors.accent} />;
}

export default function EventAlbum({
  event,
  isLeader,
  userId,
  refreshSeq,
  onPhotosChange,
  uploadsClosedOverride,
  onReopenRoll,
  coverPhotoId,
  onSetCoverPhoto,
  previewCount,
  onShowAll,
}: Props) {
  const { profile } = useAuth();
  const { showProPrompt } = useProPrompt();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { colors, type, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type, mode === 'dark'), [colors, type, mode]);
  const { width: screenWidth } = useWindowDimensions();
  // Photos here reported to you as host, still waiting on keep or delete.
  // Only the host's list has any (they're loaded by host).
  const { hostReports } = useUnread();
  const reportByPhoto = useMemo(
    () =>
      new Map(hostReports.filter((r) => r.event_id === event.id).map((r) => [r.photo_id, r.id])),
    [hostReports, event.id]
  );
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [selectedCoverId, setSelectedCoverId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [busySaving, setBusySaving] = useState(false);
  // The ⋯ menu in the photo viewer: save, event photo, report, delete.
  const [viewerMenu, setViewerMenu] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<UploadAllowance | null>(null);
  const [developingIds, setDevelopingIds] = useState<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);
  // null: reactions couldn't be loaded, so the bar and badges stay hidden.
  const [reactions, setReactions] = useState<Map<string, ReactionSummary> | null>(null);
  const bounce = useRef(new Animated.Value(1)).current;
  const [bouncing, setBouncing] = useState<string | null>(null);
  // When photos were last viewed, read once on mount before this visit marks
  // them read, so the "new" dots last for the visit.
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<LoadedPhoto>>(null);

  const uploadsClosed =
    uploadsClosedOverride !== undefined ? uploadsClosedOverride : event.uploads_closed;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const now = Date.now();
  const { beforeOpen, withinWindow, uploadOpen, msLeft } = rollState(event, uploadsClosed, now);
  const hoursLeft = Math.max(1, Math.round(msLeft / (60 * 60 * 1000)));

  // Shown while the roll is sealed: how long until it opens at the start.
  const countdownText = useMemo(() => {
    const diffMs = new Date(event.starts_at).getTime() - now;
    if (diffMs <= 0) return 'Opens shortly';
    const diffHours = Math.round(diffMs / (60 * 60 * 1000));
    if (diffHours < 1) {
      const diffMins = Math.max(1, Math.round(diffMs / (60 * 1000)));
      return `Opens in ${diffMins}m`;
    }
    if (diffHours < 24) {
      return `Opens in ${diffHours}h`;
    }
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    return `Opens in ${diffDays}d`;
  }, [event.starts_at, now]);

  const panY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (viewerIndex === null) {
      panY.setValue(0);
    }
  }, [viewerIndex, panY]);

  const touchStartRef = useRef<{ y: number; x: number; time: number } | null>(null);

  const closeViewer = useCallback(() => {
    panY.setValue(0);
    setReporting(false);
    setViewerIndex(null);
  }, [panY]);

  const handleTouchStart = useCallback((e: GestureResponderEvent) => {
    touchStartRef.current = {
      y: e.nativeEvent.pageY,
      x: e.nativeEvent.pageX,
      time: Date.now(),
    };
  }, []);

  const handleTouchMove = useCallback((e: GestureResponderEvent) => {
    if (!touchStartRef.current) return;
    const dy = e.nativeEvent.pageY - touchStartRef.current.y;
    const dx = e.nativeEvent.pageX - touchStartRef.current.x;
    // Follow the finger downward when the gesture is downward and vertical
    if (dy > 0 && dy > Math.abs(dx) * 0.8) {
      panY.setValue(dy);
    }
  }, [panY]);

  const handleTouchEnd = useCallback((e: GestureResponderEvent) => {
    if (!touchStartRef.current) return;
    const dy = e.nativeEvent.pageY - touchStartRef.current.y;
    const dt = Math.max(1, Date.now() - touchStartRef.current.time);
    const vy = dy / dt;
    touchStartRef.current = null;

    if (dy > 60 || (dy > 20 && vy > 0.3)) {
      hapticLight();
      Animated.timing(panY, {
        toValue: 600,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        panY.setValue(0);
        setViewerIndex(null);
      });
    } else {
      Animated.spring(panY, {
        toValue: 0,
        tension: 120,
        friction: 14,
        useNativeDriver: true,
      }).start();
    }
  }, [panY]);

  const handleTouchCancel = useCallback(() => {
    touchStartRef.current = null;
    Animated.spring(panY, {
      toValue: 0,
      tension: 120,
      friction: 14,
      useNativeDriver: true,
    }).start();
  }, [panY]);

  const load = useCallback(async () => {
    const [{ data: allRows }, blockedIds] = await Promise.all([
      supabase
        .from('photos')
        .select('*')
        .eq('event_id', event.id)
        .order('created_at', { ascending: true }),
      loadBlockedIds(),
    ]);
    if (!allRows) {
      setLoaded(true);
      return;
    }
    // Photos and videos from people you've blocked stay out of your roll.
    const rows = allRows.filter((r) => !blockedIds.has(r.uploader_id));

    // Links are reused (lib/signedUrls), so photos already seen load from
    // the phone's cache. A video's own link waits until it plays.
    const uploaderIds = [...new Set(rows.map((r) => r.uploader_id))];
    // Videos too, for their still frame.
    const [linkByPath, { data: profiles }] = await Promise.all([
      signedLinks(BUCKET, rows.map((r) => r.storage_path)),
      uploaderIds.length > 0
        ? supabase.from('profiles').select('*').in('id', uploaderIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    ]);

    const loadedList: LoadedPhoto[] = rows.map((r) => ({
      ...r,
      url: r.kind === 'video' ? null : (linkByPath.get(r.storage_path)?.url ?? null),
      thumbUrl: linkByPath.get(r.storage_path)?.thumb ?? null,
      uploaderName:
        guestName(profiles?.find((p) => p.id === r.uploader_id)),
    }));

    animateNext(hasLoadedRef.current);
    setPhotos(loadedList);
    onPhotosChange?.(loadedList);
    setLoaded(true);
    hasLoadedRef.current = true;
    return loadedList;
  }, [event.id, onPhotosChange]);

  const refreshAllowance = useCallback(async () => {
    setAllowance(await loadUploadAllowance());
  }, []);

  useEffect(() => {
    refreshAllowance();
  }, [refreshAllowance]);

  // When the photos are deleted (free hosts' events), or null if kept.
  const [expiry, setExpiry] = useState<PhotoExpiry | null>(null);
  useEffect(() => {
    let live = true;
    loadPhotoExpiry([event.id]).then((map) => {
      if (live) setExpiry(map[event.id] ?? null);
    });
    return () => {
      live = false;
    };
  }, [event.id, refreshSeq]);

  // In the last week, remind the host once a day that Pro would keep them.
  useEffect(() => {
    const at = expiry?.expiresAt;
    if (!isLeader || !at || expiry?.expiredAt || daysLeft(at) > WARN_DAYS) return;
    const key = `rollcal.expiryPrompt.${event.id}`;
    const today = new Date().toDateString();
    AsyncStorage.getItem(key)
      .then((shown) => {
        if (shown === today) return;
        AsyncStorage.setItem(key, today);
        showProPrompt('expiry');
      })
      .catch(() => {});
  }, [expiry, isLeader, event.id, showProPrompt]);

  useEffect(() => {
    load();
  }, [load, refreshSeq]);

  useEffect(() => {
    let live = true;
    getPhotoReadMap(userId)
      .then((map) => {
        if (!live) return;
        const at = map[event.id];
        // A mark written seconds ago is this visit's own; use the one before.
        setLastSeen(at && isRecentMark(at) ? (previousPhotoMark(event.id) ?? null) : (at ?? null));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // Once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const photoIdsKey = useMemo(() => photos.map((p) => p.id).join(','), [photos]);
  useEffect(() => {
    if (!photoIdsKey) return;
    let live = true;
    loadReactions(photoIdsKey.split(','), userId).then((m) => {
      if (live) setReactions(m);
    });
    return () => {
      live = false;
    };
  }, [photoIdsKey, userId, refreshSeq]);

  const react = async (photoId: string, emoji: string) => {
    if (!reactions) return;
    const was = reactions.get(photoId)?.mine.has(emoji) ?? false;
    const apply = (on: boolean) =>
      setReactions((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        const cur = next.get(photoId);
        const counts = { ...(cur?.counts ?? { '❤️': 0, '😂': 0, '🔥': 0 }) };
        const mine = new Set(cur?.mine ?? []);
        counts[emoji] = Math.max(0, (counts[emoji] ?? 0) + (on ? 1 : -1));
        if (on) mine.add(emoji);
        else mine.delete(emoji);
        next.set(photoId, { counts, mine });
        return next;
      });
    hapticLight();
    setBouncing(`${photoId}${emoji}`);
    bounce.setValue(1);
    Animated.sequence([
      Animated.spring(bounce, { toValue: 1.2, speed: 40, bounciness: 0, useNativeDriver: true }),
      Animated.spring(bounce, { toValue: 1, speed: 40, bounciness: 8, useNativeDriver: true }),
    ]).start();
    apply(!was);
    const ok = await toggleReaction(photoId, userId, emoji, !was);
    if (!ok) apply(was);
  };

  const isNewPhoto = (p: LoadedPhoto) =>
    !!lastSeen && p.uploader_id !== userId && p.created_at > lastSeen;
  const badgeOf = (p: LoadedPhoto) => badgeFor(reactions?.get(p.id));

  // Who the host let add photos, when only the host may (post-permissions.sql).
  const [allowed, setAllowed] = useState<Allowed[]>([]);
  useEffect(() => {
    if (event.photos_by !== 'host' || isLeader) return;
    let live = true;
    loadAllowed(event.id).then((rows) => {
      if (live) setAllowed(rows);
    });
    return () => {
      live = false;
    };
  }, [event.id, event.photos_by, isLeader, refreshSeq]);
  const canAdd = mayPost(event, userId, 'photos', allowed);

  const addPhotos = async () => {
    const isPro = !!profile?.is_pro;
    const blocked = await uploadBlocker(isPro);
    if (blocked === 'storage') {
      showProPrompt('storage');
      return;
    }
    if (blocked) {
      setNotice(blocked);
      return;
    }
    const assets = await pickRollMedia();
    if (assets.length === 0) return;

    setUploading(`0/${assets.length}`);
    const { uploaded, needsPro, problems } = await uploadRollMedia(
      event.id,
      userId,
      isPro,
      assets,
      (done, total) => setUploading(`${done}/${total}`)
    );
    setUploading(null);

    // uploadRollMedia plays the shutter haptic when something went up.
    if (uploaded === 0) hapticLight();
    const knownIds = new Set(photos.map((p) => p.id));
    const fresh = await load();
    if (uploaded > 0 && fresh) {
      setDevelopingIds(new Set(fresh.filter((p) => !knownIds.has(p.id)).map((p) => p.id)));
      setTimeout(() => {
        setDevelopingIds(new Set());
      }, 1500);
    }
    refreshAllowance();

    if (problems.length > 0) setNotice(problems[0]);
    if (needsPro) showProPrompt(needsPro);
  };

  const saveToDevice = async (photo: LoadedPhoto): Promise<boolean> => {
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) {
      Alert.alert(
        'Saving unavailable',
        "This build can't reach your photo library. Viewing photos still works."
      );
      return false;
    }
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to save to your camera roll.');
      return false;
    }
    // From R2 or, for files not copied there yet, Supabase Storage.
    const link = await signedUrl(BUCKET, photo.storage_path);
    if (!link) return false;
    // The extension (.jpg, .mp4, .mov) tells the library what it's saving.
    const filename = photo.storage_path.split('/').pop() ?? (photo.kind === 'video' ? 'video.mp4' : 'photo.jpg');
    const target = new File(Paths.cache, filename);
    if (target.exists) target.delete();
    const downloaded = await File.downloadFileAsync(link, target);
    await MediaLibrary.saveToLibraryAsync(downloaded.uri);
    return true;
  };

  const saveOne = async (photo: LoadedPhoto) => {
    setBusySaving(true);
    try {
      const ok = await saveToDevice(photo);
      if (ok) {
        hapticLight();
        setNotice('Saved to your camera roll.');
      }
    } catch {
      Alert.alert('Save failed', 'Could not save this one.');
    } finally {
      setBusySaving(false);
    }
  };

  const saveAll = async () => {
    let done = 0;
    setSavingAll(`0/${photos.length}`);
    try {
      for (const photo of photos) {
        const ok = await saveToDevice(photo);
        if (!ok) break;
        done += 1;
        setSavingAll(`${done}/${photos.length}`);
      }
      if (done === photos.length) {
        hapticLight();
        setNotice(
          done === 1
            ? 'Saved to your camera roll.'
            : `All ${done} saved to your camera roll.`
        );
      }
    } catch {
      Alert.alert('Save failed', `Saved ${done} of ${photos.length}.`);
    } finally {
      setSavingAll(null);
    }
  };

  const toggleCoverPhoto = (photoId: string) => {
    hapticLight();
    const nextId = coverPhotoId === photoId ? null : photoId;
    onSetCoverPhoto?.(nextId);
    setNotice(
      nextId ? 'Set as the event photo.' : 'Removed as event photo.'
    );
  };

  const deletePhoto = async () => {
    const photo = photos.find((p) => p.id === confirmDeleteId);
    setConfirmDeleteId(null);
    if (!photo) return;
    if (photo.id === coverPhotoId) {
      onSetCoverPhoto?.(null);
    }
    setViewerIndex(null);
    await supabase.storage.from(BUCKET).remove([photo.storage_path]);
    await supabase.from('photos').delete().eq('id', photo.id);
    hapticLight();
    load();
  };

  const isUrgentWindow = uploadOpen && msLeft > 0 && msLeft <= 3 * 60 * 60 * 1000;
  const minutesLeft = Math.max(1, Math.round(msLeft / (60 * 1000)));
  const timeLeftText = hoursLeft <= 1 ? `${minutesLeft} minutes` : `${hoursLeft} hours`;

  const uniqueUploaderCount = useMemo(
    () => new Set(photos.map((p) => p.uploader_id)).size,
    [photos]
  );
  const peopleCount = Math.max(1, uniqueUploaderCount);

  const photoSummary = `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} from ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}.`;

  let statusLine = '';
  let mutedSummaryLine: string | null = null;

  if (beforeOpen) {
    statusLine = 'Photos open when the event starts.';
  } else if (uploadOpen) {
    statusLine = `Add photos for ${timeLeftText}.`;
  } else if (withinWindow && uploadsClosed) {
    statusLine = isLeader ? 'You closed adding photos early.' : 'The host closed adding photos.';
    if (photos.length > 0) {
      mutedSummaryLine = photoSummary;
    }
  } else {
    if (photos.length > 0) {
      statusLine = 'Adding photos is closed.';
      mutedSummaryLine = photoSummary;
    } else {
      statusLine = 'Adding photos is closed. No photos were added.';
    }
  }

  // Free events: how long the photos are kept, or that they've gone.
  const photosExpired = !!expiry?.expiredAt;
  const showReopen = isLeader && !beforeOpen && !uploadOpen && !photosExpired && !!onReopenRoll;
  const expiresAt = expiry?.expiresAt ?? null;
  // Free events can be kept with an Event Pass (or a plan).
  const canKeepForever = !!expiresAt && !photosExpired;
  const keepForever = () => {
    hapticLight();
    navigation.navigate('Upgrade', { plan: 'party', eventId: event.id });
  };
  const expiringSoon = !photosExpired && !!expiresAt && daysLeft(expiresAt) <= WARN_DAYS;
  let expiryLine: string | null = null;
  if (photosExpired) {
    statusLine = 'Adding photos is closed.';
    mutedSummaryLine = null;
    expiryLine = 'This event’s photos were deleted 30 days after it ended.';
  } else if (expiresAt && !beforeOpen) {
    const days = daysLeft(expiresAt);
    expiryLine = expiringSoon
      ? `Photos are deleted ${days <= 1 ? 'tomorrow' : `in ${days} days`}. Save the ones you want.`
      : `Photos are kept until ${new Date(expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.`;
  }

  const hasCover = useMemo(() => {
    return !!coverPhotoId && photos.some((p) => p.id === coverPhotoId);
  }, [coverPhotoId, photos]);

  const displayPhotos = useMemo(() => {
    if (!hasCover) return photos;
    const cover = photos.find((p) => p.id === coverPhotoId);
    if (!cover) return photos;
    const rest = photos.filter((p) => p.id !== coverPhotoId);
    return [cover, ...rest];
  }, [photos, coverPhotoId, hasCover]);

  // Capped: the first previewCount - 1 photos, then a "+N more" tile. The
  // viewer still swipes through every photo.
  const capped = !!previewCount && displayPhotos.length > previewCount;
  const gridPhotos = capped ? displayPhotos.slice(0, previewCount! - 1) : displayPhotos;
  const morePhotos = displayPhotos.slice(gridPhotos.length);

  // The last tile when capped: the next photo, dimmed, under the count. Red
  // like the others when a photo reported to you is among the rest.
  const moreTile = (slot: number) => {
    const next = morePhotos[0];
    const uri = next?.thumbUrl ?? next?.url ?? null;
    return (
      <Pressable
        key="more"
        onPress={() => {
          hapticLight();
          onShowAll?.();
        }}
        accessibilityRole="button"
        accessibilityLabel={`See all ${displayPhotos.length} photos and videos`}
        style={({ pressed }) => [
          styles.moreTile,
          {
            width: colWidth,
            height: colWidth,
            marginRight: slot % 3 === 2 ? 0 : GRID_GAP,
            marginBottom: GRID_GAP,
          },
          pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} blurRadius={10} style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} />
        ) : null}
        <Text style={styles.moreCount}>+{morePhotos.length}</Text>
        <Text style={styles.moreLabel}>more</Text>
        {morePhotos.some((p) => reportByPhoto.has(p.id)) ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { borderWidth: 3, borderColor: colors.danger }]}
          />
        ) : null}
      </Pressable>
    );
  };

  const openCoverPicker = () => {
    setSelectedCoverId(coverPhotoId ?? null);
    setShowCoverPicker(true);
  };

  const viewerList = displayPhotos;
  const viewerPhoto = viewerIndex !== null ? viewerList[viewerIndex] : null;

  // The viewer follows a photo, not a position: setting or removing the
  // event photo reorders the list (the event photo goes first), and without
  // this the viewer stayed at the same position and showed a different
  // photo, with "Set as the event photo" under it.
  const viewerPhotoIdRef = useRef<string | null>(null);
  useEffect(() => {
    viewerPhotoIdRef.current = viewerIndex !== null ? (viewerList[viewerIndex]?.id ?? null) : null;
    // Only when the person moves; a reorder is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerIndex]);
  useEffect(() => {
    const id = viewerPhotoIdRef.current;
    if (viewerIndex === null || !id) return;
    const index = displayPhotos.findIndex((p) => p.id === id);
    if (index >= 0 && index !== viewerIndex) {
      setViewerIndex(index);
      flatListRef.current?.scrollToIndex({ index, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPhotos]);
  // A reported tile opens its report (keep or delete), the same screen as
  // the notification; any other opens the viewer.
  const openTile = (index: number) => {
    const reportId = reportByPhoto.get(displayPhotos[index]?.id ?? '');
    if (reportId) navigation.navigate('HostReport', { reportId });
    else setViewerIndex(index);
  };
  const viewerIsVideo = viewerPhoto?.kind === 'video';
  // The reactions stay in one place at the bottom, so swiping between
  // photos doesn't make them jump. Videos: above the player's controls.
  const reactionBottom = viewerIsVideo ? 96 : spacing.lg;
  const canDeleteViewer =
    viewerPhoto != null && (isLeader || viewerPhoto.uploader_id === userId);
  const canReportViewer = viewerPhoto != null && viewerPhoto.uploader_id !== userId;

  let allowanceNote: string | null = null;
  if (allowance && overAllowance(allowance)) {
    allowanceNote = `You’ve used all ${formatBytes(allowance.storedLimit)} of your storage. Remove some uploads to add more.`;
  } else if (allowance && nearAllowance(allowance)) {
    allowanceNote = `You’ve used ${formatBytes(allowance.stored)} of your ${formatBytes(allowance.storedLimit)} of storage.`;
  }

  // Photos sit inside the film strip with a small border on each side.
  const gridWidth = screenWidth - FILM_FRAME * 2;
  const colWidth = Math.floor((gridWidth - GRID_GAP * 2) / 3);
  const featureSize = colWidth * 2 + GRID_GAP;
  const sideRemainingWidth = gridWidth - featureSize - GRID_GAP;

  return (
    <View style={styles.container}>
      {/* The film strip: counter, status and actions on dark film stock. */}
      <View
        style={[
          styles.band,
          { width: screenWidth },
        ]}
      >
        <Sprockets width={screenWidth} />
        <View style={styles.bandBody}>
          <View style={styles.headerRow}>
            <View style={styles.titleWrap}>
              <ExposureCounter count={beforeOpen ? 0 : photos.length} />
              {uploadOpen && !photosExpired && (
                <View style={styles.livePill}>
                  <Text style={styles.livePillText}>Open now</Text>
                </View>
              )}
              {beforeOpen && (
                <View style={styles.canisterCountdownPill}>
                  <Text style={styles.canisterCountdownText}>{countdownText}</Text>
                </View>
              )}
              <InfoTip
                title="Adding photos"
                text="Everyone in the event can add photos from when it starts until two days after it ends."
              />
            </View>
            {photos.length > 0 && !beforeOpen && (
              <View style={styles.headerActions}>
                {canKeepForever && (
                  <Pressable
                    onPress={keepForever}
                    hitSlop={8}
                    accessibilityRole="button"
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.keepText}>Keep forever</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={saveAll}
                  disabled={savingAll !== null}
                  hitSlop={8}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.saveAllText}>
                    {savingAll ? `Saving ${savingAll}…` : 'Save all'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {beforeOpen ? null : (
            <View style={styles.statusWrap}>
              {/* One line, the most urgent thing first. */}
              {photosExpired || expiringSoon ? (
                // Coral and tappable: the way to keep them is one tap away.
                <Pressable
                  disabled={photosExpired}
                  onPress={keepForever}
                  accessibilityRole={photosExpired ? undefined : 'link'}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.statusLine, expiringSoon && styles.expiryLine]}>
                    {expiryLine}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.statusLineRow}>
                  {isUrgentWindow && <View style={styles.urgentDot} />}
                  <Text style={[styles.statusLine, isUrgentWindow && styles.urgentStatusLine]}>
                    {mutedSummaryLine ? `${statusLine} ${mutedSummaryLine}` : statusLine}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Host tools, on the strip they act on. */}
          {isLeader && !beforeOpen && (showReopen || photos.length > 0) && (
            <View style={styles.toolRow}>
              {showReopen && (
                <Pressable
                  onPress={() => {
                    hapticLight();
                    onReopenRoll?.();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.toolChip, pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }]}
                >
                  <Text style={styles.toolChipText}>Reopen for 24h</Text>
                </Pressable>
              )}
              {photos.length > 0 && (
                <Pressable
                  onPress={() => {
                    hapticLight();
                    openCoverPicker();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.toolChip, pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }]}
                >
                  <Text style={styles.toolChipText}>{hasCover ? 'Change event photo' : 'Set event photo'}</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

      {/* Add photos and the photos themselves, on the same strip of film. */}
      {uploadOpen && (
        <View style={[styles.actionRow, styles.bandInset]}>
          {uploadOpen && !canAdd && (
            <Text style={[type.caption, { flexBasis: '100%' }]}>{POST_BLOCKED_NOTE.photos}</Text>
          )}
          {uploadOpen && canAdd && (
            <Button
              title={uploading ? `Uploading ${uploading}…` : 'Add photos'}
              onPress={addPhotos}
              disabled={uploading !== null}
              style={styles.addButton}
            />
          )}
        </View>
      )}

      {uploadOpen && allowanceNote && (
        <View style={[styles.allowanceRow, styles.bandInset]}>
          <Text style={styles.allowanceText}>{allowanceNote}</Text>
          {!allowance?.isPro && (
            <Pressable
              accessibilityRole="link"
              onPress={() => navigation.navigate('Upgrade', { reason: 'storage' })}
              style={({ pressed }) => [styles.allowanceLink, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.allowanceLinkText}>See plans</Text>
            </Pressable>
          )}
        </View>
      )}

      {notice && <Text style={[styles.notice, styles.bandInset]}>{notice}</Text>}

      {/* Edge-to-edge photo grid. Sealed until the event starts, even if the
          host has already added a cover. */}
      {beforeOpen ? null : !loaded ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
      ) : displayPhotos.length > 0 ? (
        <View style={[styles.gridWrap, { width: gridWidth }]}>
          {!hasCover ? (
            /* Uniform 3-column square grid: all photos same equal size, none bigger than the other */
            <View style={styles.uniformGrid}>
              {gridPhotos.map((photo, index) => {
                const colIndex = index % 3;
                const isLastInRow = colIndex === 2;
                return (
                  <DevelopingPhotoItem
                    key={photo.id}
                    photo={photo}
                    imageStyle={styles.gridImage}
                    isDeveloping={developingIds.has(photo.id)}
                    reported={reportByPhoto.has(photo.id)}
                    reaction={badgeOf(photo)}
                    isNew={isNewPhoto(photo)}
                    onPress={() => openTile(index)}
                    style={{
                      width: colWidth,
                      height: colWidth,
                      marginRight: isLastInRow ? 0 : GRID_GAP,
                      marginBottom: GRID_GAP,
                    }}
                  />
                );
              })}
              {capped && moreTile(gridPhotos.length)}
            </View>
          ) : displayPhotos.length === 1 ? (
            /* Single cover photo */
            <DevelopingPhotoItem
              photo={displayPhotos[0]}
              imageStyle={styles.gridImage}
              isDeveloping={developingIds.has(displayPhotos[0].id)}
              reported={reportByPhoto.has(displayPhotos[0].id)}
              reaction={badgeOf(displayPhotos[0])}
              isNew={isNewPhoto(displayPhotos[0])}
              onPress={() => openTile(0)}
              // Same 2x2 square as when there are more photos.
              style={{ width: featureSize, height: featureSize }}
            >
              <View style={styles.gridCoverTag}>
                <Text style={styles.gridCoverTagText}>Cover</Text>
              </View>
            </DevelopingPhotoItem>
          ) : displayPhotos.length === 2 ? (
            /* 2 photos with cover featured */
            <View style={[styles.featureRow, { height: featureSize }]}>
              <DevelopingPhotoItem
                photo={displayPhotos[0]}
                imageStyle={styles.gridImage}
                isDeveloping={developingIds.has(displayPhotos[0].id)}
                reported={reportByPhoto.has(displayPhotos[0].id)}
                reaction={badgeOf(displayPhotos[0])}
                isNew={isNewPhoto(displayPhotos[0])}
                onPress={() => openTile(0)}
                style={{
                  width: featureSize,
                  height: featureSize,
                  marginRight: GRID_GAP,
                }}
              >
                <View style={styles.gridCoverTag}>
                  <Text style={styles.gridCoverTagText}>Cover</Text>
                </View>
              </DevelopingPhotoItem>
              <DevelopingPhotoItem
                photo={displayPhotos[1]}
                imageStyle={styles.gridImage}
                isDeveloping={developingIds.has(displayPhotos[1].id)}
                reported={reportByPhoto.has(displayPhotos[1].id)}
                reaction={badgeOf(displayPhotos[1])}
                isNew={isNewPhoto(displayPhotos[1])}
                onPress={() => openTile(1)}
                style={{
                  width: sideRemainingWidth,
                  height: featureSize,
                }}
              />
            </View>
          ) : (
            // With a cover chosen, it leads the grid as a 2x2 tile.
            <>
              <View style={[styles.featureRow, { height: featureSize }]}>
                <DevelopingPhotoItem
                  photo={displayPhotos[0]}
                  imageStyle={styles.gridImage}
                  isDeveloping={developingIds.has(displayPhotos[0].id)}
                  reported={reportByPhoto.has(displayPhotos[0].id)}
                  reaction={badgeOf(displayPhotos[0])}
                  isNew={isNewPhoto(displayPhotos[0])}
                  onPress={() => openTile(0)}
                  style={{
                    width: featureSize,
                    height: featureSize,
                    marginRight: GRID_GAP,
                  }}
                >
                  <View style={styles.gridCoverTag}>
                    <Text style={styles.gridCoverTagText}>Cover</Text>
                  </View>
                </DevelopingPhotoItem>

                <View
                  style={{
                    width: sideRemainingWidth,
                    height: featureSize,
                    justifyContent: 'space-between',
                  }}
                >
                  <DevelopingPhotoItem
                    photo={displayPhotos[1]}
                    imageStyle={styles.gridImage}
                    isDeveloping={developingIds.has(displayPhotos[1].id)}
                    reported={reportByPhoto.has(displayPhotos[1].id)}
                    reaction={badgeOf(displayPhotos[1])}
                    isNew={isNewPhoto(displayPhotos[1])}
                    onPress={() => openTile(1)}
                    style={{ width: sideRemainingWidth, height: colWidth }}
                  />
                  <DevelopingPhotoItem
                    photo={displayPhotos[2]}
                    imageStyle={styles.gridImage}
                    isDeveloping={developingIds.has(displayPhotos[2].id)}
                    reported={reportByPhoto.has(displayPhotos[2].id)}
                    reaction={badgeOf(displayPhotos[2])}
                    isNew={isNewPhoto(displayPhotos[2])}
                    onPress={() => openTile(2)}
                    style={{ width: sideRemainingWidth, height: colWidth }}
                  />
                </View>
              </View>

              {(gridPhotos.length > 3 || capped) && (
                <View style={styles.trailingGrid}>
                  {gridPhotos.slice(3).map((photo, idx) => {
                    const realIndex = idx + 3;
                    const colIndex = idx % 3;
                    const isLastInRow = colIndex === 2;
                    return (
                      <DevelopingPhotoItem
                        key={photo.id}
                        photo={photo}
                        imageStyle={styles.gridImage}
                        isDeveloping={developingIds.has(photo.id)}
                        reported={reportByPhoto.has(photo.id)}
                        reaction={badgeOf(photo)}
                        isNew={isNewPhoto(photo)}
                        onPress={() => openTile(realIndex)}
                        style={{
                          width: colWidth,
                          height: colWidth,
                          marginRight: isLastInRow ? 0 : GRID_GAP,
                          marginBottom: GRID_GAP,
                        }}
                      />
                    );
                  })}
                  {capped && moreTile(gridPhotos.length - 3)}
                </View>
              )}
            </>
          )}
        </View>
      ) : uploadOpen ? (
        <View style={[styles.emptyWrap, styles.bandInset]}>
          <EmptyNote>No photos yet. Somebody take one.</EmptyNote>
        </View>
      ) : null}
        <Sprockets width={screenWidth} />
      </View>

      <Modal
        visible={viewerPhoto !== null}
        animationType="fade"
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={closeViewer}
      >
        {viewerPhoto && (
          // Safe-area padding comes from the app's insets, not a SafeAreaView:
          // inside a Modal that measured the top as 0 some times and the real
          // inset others, so the header jumped down and the photo shrank.
          // The top is padded in viewerTop below.
          <View style={[styles.viewer, { paddingBottom: insets.bottom }]}>
            <Animated.View
              collapsable={false}
              style={{
                flex: 1,
                transform: [{ translateY: panY }],
                opacity: panY.interpolate({
                  inputRange: [0, 300],
                  outputRange: [1, 0.6],
                  extrapolate: 'clamp',
                }),
              }}
            >
            <View
              style={[
                styles.viewerTop,
                {
                  paddingTop:
                    Math.max(
                      insets.top,
                      Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 16
                    ) + spacing.xs,
                },
              ]}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchCancel}
            >
              <View style={styles.viewerMetaBlock}>
                <Text style={styles.viewerUploader} numberOfLines={1}>
                  {viewerPhoto.uploaderName}
                </Text>
                <Text style={styles.viewerIndexText}>
                  {(viewerIndex ?? 0) + 1} of {viewerList.length}
                </Text>
              </View>

              <View style={styles.viewerTopRight}>
                <Pressable
                  onPress={() => setViewerMenu(true)}
                  disabled={busySaving}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={busySaving ? 'Saving' : 'More options'}
                  style={({ pressed }) => [
                    styles.viewerIconBtn,
                    (pressed || busySaving) && { opacity: 0.5 },
                  ]}
                >
                  <MoreIcon size={22} color={colors.ink} />
                </Pressable>
                <Pressable
                  onPress={closeViewer}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={({ pressed }) => [
                    styles.viewerIconBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <CloseIcon size={20} color={colors.ink} />
                </Pressable>
              </View>
            </View>

            <View style={styles.viewerCenterArea}>
              <FlatList
                ref={flatListRef}
                data={viewerList}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(p) => p.id}
                extraData={viewerIndex}
                initialScrollIndex={viewerIndex ?? 0}
                getItemLayout={(_, i) => ({
                  length: screenWidth,
                  offset: screenWidth * i,
                  index: i,
                })}
                onScrollToIndexFailed={(info) => {
                  setTimeout(() => {
                    flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
                  }, 50);
                }}
                onMomentumScrollEnd={(e) =>
                  setViewerIndex(
                    Math.max(
                      0,
                      Math.min(
                        viewerList.length - 1,
                        Math.round(e.nativeEvent.contentOffset.x / screenWidth)
                      )
                    )
                  )
                }
                style={{ flex: 1 }}
                renderItem={({ item, index }) =>
                  item.kind === 'video' ? (
                    <View
                      style={[
                        styles.viewerScrollContent,
                        { width: screenWidth, height: '100%' },
                      ]}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchCancel}
                    >
                      {index === viewerIndex && <RollVideo storagePath={item.storage_path} />}
                    </View>
                  ) : Platform.OS === 'ios' ? (
                    <ScrollView
                      maximumZoomScale={3}
                      minimumZoomScale={1}
                      centerContent
                      showsHorizontalScrollIndicator={false}
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={styles.viewerScrollContent}
                      style={{ width: screenWidth, height: '100%' }}
                    >
                      <View
                        style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={handleTouchCancel}
                      >
                        {item.url && (
                          <Image
                            source={{ uri: item.url }}
                            style={styles.viewerImage}
                            resizeMode="contain"
                          />
                        )}
                      </View>
                    </ScrollView>
                  ) : (
                    <View
                      style={[
                        styles.viewerScrollContent,
                        { width: screenWidth, height: '100%' },
                      ]}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchCancel}
                    >
                      {item.url && (
                        <Image
                          source={{ uri: item.url }}
                          style={styles.viewerImage}
                          resizeMode="contain"
                        />
                      )}
                    </View>
                  )
                }
              />

              {viewerIndex !== null && viewerIndex > 0 && (
                <Pressable
                  onPress={() => {
                    const prevIdx = viewerIndex - 1;
                    setViewerIndex(prevIdx);
                    flatListRef.current?.scrollToIndex({ index: prevIdx, animated: true });
                  }}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.navArrowBtn,
                    styles.navArrowLeft,
                    pressed && { opacity: 0.6, transform: [{ scale: 0.95 }] },
                  ]}
                >
                  <ChevronLeftIcon size={22} color={colors.ink} />
                </Pressable>
              )}

              {viewerIndex !== null && viewerIndex < viewerList.length - 1 && (
                <Pressable
                  onPress={() => {
                    const nextIdx = viewerIndex + 1;
                    setViewerIndex(nextIdx);
                    flatListRef.current?.scrollToIndex({ index: nextIdx, animated: true });
                  }}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.navArrowBtn,
                    styles.navArrowRight,
                    pressed && { opacity: 0.6, transform: [{ scale: 0.95 }] },
                  ]}
                >
                  <ChevronRightIcon size={22} color={colors.ink} />
                </Pressable>
              )}
              {/* The event photo is marked on the photo itself, like its
                  tile in the roll. Changing it is in the ⋯ menu. */}
              {viewerPhoto.id === coverPhotoId && (
                <View style={styles.viewerCoverTag} pointerEvents="none">
                  <Text style={styles.viewerCoverTagText}>Event photo</Text>
                </View>
              )}

              {/* Reactions float over the bottom of the photo, on see-through
                  pills, so the photo stays the whole screen. */}
              {reactions && (
                <View
                  style={[
                    styles.reactionBar,
                    { bottom: reactionBottom },
                  ]}
                  pointerEvents="box-none"
                >
                  {REACTIONS.map((emoji) => {
                    const mine = reactions.get(viewerPhoto.id)?.mine.has(emoji) ?? false;
                    const count = reactions.get(viewerPhoto.id)?.counts[emoji] ?? 0;
                    const name = REACTION_NAMES[emoji];
                    const active = bouncing === `${viewerPhoto.id}${emoji}`;
                    return (
                      <Pressable
                        key={emoji}
                        onPress={() => react(viewerPhoto.id, emoji)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: mine }}
                        accessibilityLabel={
                          mine ? `Remove ${name} reaction` : `React with ${name}${count > 0 ? `, ${count}` : ''}`
                        }
                        style={({ pressed }) => [
                          styles.reactionPill,
                          mine && styles.reactionPillOn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Animated.View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            transform: [{ scale: active ? bounce : 1 }],
                          }}
                        >
                          <Text style={{ fontSize: 22 }}>{emoji}</Text>
                          {count > 0 && (
                            <Text style={[styles.reactionCount, mine && styles.reactionCountOn]}>
                              {count}
                            </Text>
                          )}
                        </Animated.View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {notice && <Text style={styles.viewerNotice}>{notice}</Text>}

            </Animated.View>
            <ActionMenuSheet
              visible={viewerMenu}
              onClose={() => setViewerMenu(false)}
              options={[
                {
                  label: viewerIsVideo ? 'Save video' : 'Save photo',
                  onPress: () => saveOne(viewerPhoto),
                },
                ...(isLeader && !viewerIsVideo
                  ? [
                      {
                        label:
                          viewerPhoto.id === coverPhotoId
                            ? 'Remove as event photo'
                            : 'Set as event photo',
                        onPress: () => toggleCoverPhoto(viewerPhoto.id),
                      },
                    ]
                  : []),
                ...(canReportViewer
                  ? [{ label: 'Report', onPress: () => setReporting(true) }]
                  : []),
                ...(canDeleteViewer
                  ? [
                      {
                        label: viewerIsVideo ? 'Delete video' : 'Delete photo',
                        destructive: true,
                        onPress: () => setConfirmDeleteId(viewerPhoto.id),
                      },
                    ]
                  : []),
              ]}
            />
            <ReportSheet
              visible={reporting}
              target="photo"
              targetId={viewerPhoto.id}
              targetUserId={viewerPhoto.uploader_id}
              subject={viewerIsVideo ? 'this video' : 'this photo'}
              hostId={event.creator_id}
              onClose={() => setReporting(false)}
            />
            {/* Inside the viewer, like the report sheet: iOS shows a pop-up
                over the viewer only if it belongs to it, so out here it
                waited until the viewer closed. */}
            <ConfirmDialog
              visible={confirmDeleteId !== null}
              title={viewerIsVideo ? 'Delete this video?' : 'Delete this photo?'}
              message="It's removed for everyone in the event."
              confirmLabel="Delete"
              destructive
              onConfirm={deletePhoto}
              onCancel={() => setConfirmDeleteId(null)}
            />
          </View>
        )}
      </Modal>

      <Modal
        visible={showCoverPicker}
        // iOS: a native sheet, which dims the screen itself. Android: the
        // sheet sits on a see-through layer with the scrim, so it fades in
        // place; sliding would carry the scrim up with it.
        animationType={Platform.OS === 'ios' ? 'slide' : 'fade'}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS === 'android'}
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={() => setShowCoverPicker(false)}
      >
        <View style={Platform.OS === 'android' ? styles.sheetOverlay : { flex: 1 }}>
          <SafeAreaView
            style={styles.pickerModalScreen}
            edges={['top', 'bottom']}
          >
            <View style={styles.pickerHeader}>
              <View style={styles.pickerHeaderLeft}>
                <Text style={styles.pickerTitle}>Event photo</Text>
                <Text style={styles.pickerSubtitle}>
                  Choose which photo represents this event
                </Text>
              </View>
              <Pressable
                onPress={() => setShowCoverPicker(false)}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.pickerCloseBtn,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <CloseIcon size={20} color={colors.ink} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={[
                styles.pickerScrollContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 72 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.uniformGrid, { width: screenWidth }]}>
                {photos.filter((p) => p.kind !== 'video').map((photo, index) => {
                  const colIndex = index % 3;
                  const isLastInRow = colIndex === 2;
                  const isSelected = selectedCoverId === photo.id;
                  return (
                    <Pressable
                      key={photo.id}
                      onPress={() => {
                        hapticLight();
                        setSelectedCoverId((prev) =>
                          prev === photo.id ? null : photo.id
                        );
                      }}
                      style={{
                        width: colWidth,
                        height: colWidth,
                        marginRight: isLastInRow ? 0 : GRID_GAP,
                        marginBottom: GRID_GAP,
                        position: 'relative',
                      }}
                    >
                      <Image
                        source={{ uri: photo.thumbUrl ?? photo.url ?? undefined }}
                        style={[
                          styles.gridImage,
                          isSelected && styles.pickerSelectedImage,
                        ]}
                      />
                      {isSelected && (
                        <View style={styles.pickerCheckBadge}>
                          <CheckIcon size={13} color="#FFFFFF" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <View
              pointerEvents="box-none"
              style={[
                styles.pickerBottomWrap,
                { paddingBottom: Math.max(insets.bottom, 16) + 8 },
              ]}
            >
              <Pressable
                onPress={() => {
                  hapticLight();
                  setShowCoverPicker(false);
                  if (selectedCoverId !== coverPhotoId) {
                    onSetCoverPhoto?.(selectedCoverId);
                    setNotice(
                      selectedCoverId
                        ? 'Set as the event photo.'
                        : 'Removed as event photo.'
                    );
                  }
                }}
                style={({ pressed }) => [
                  styles.pickerFloatingBtn,
                  pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text style={styles.pickerFloatingBtnText}>
                  {selectedCoverId
                    ? selectedCoverId === coverPhotoId
                      ? 'Keep as event photo'
                      : 'Set as event photo'
                    : 'Remove event photo'}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens, dark = false) => {
  const FILM = filmColors(c, dark);
  return StyleSheet.create({
    container: {},
    band: {
      backgroundColor: FILM.base,
      // Full width like the photo grid below it: a strip of film, square ends.
      marginHorizontal: -spacing.lg,
      paddingVertical: 5,
      overflow: 'hidden',
    },
    bandClosed: {
      marginBottom: spacing.md,
    },
    bandBody: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    titleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    livePill: {
      backgroundColor: c.live,
      borderRadius: radii.full,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    livePillText: {
      ...t.caption,
      fontSize: 11,
      fontFamily: fonts.bodySemiBold,
      color: c.onLive,
    },
    saveAllText: {
      ...t.body,
      fontSize: 14,
      fontFamily: fonts.bodySemiBold,
      color: FILM.text,
    },
    canisterCountdownPill: {
      backgroundColor: FILM.plate,
      borderWidth: 1,
      borderColor: FILM.hole,
      borderRadius: radii.full,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    canisterCountdownText: {
      ...t.caption,
      fontSize: 11,
      fontFamily: fonts.bodyMedium,
      color: FILM.text,
    },
    canisterSubtext: {
      ...t.caption,
      color: FILM.textMuted,
      lineHeight: 16,
    },
    statusWrap: {
      gap: 2,
      marginTop: spacing.sm,
    },
    expiryLine: { color: c.accentText, fontFamily: fonts.bodySemiBold },
    keepText: { ...t.body, fontSize: 14, fontFamily: fonts.bodySemiBold, color: c.accentText },
    statusLineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusLine: {
      ...t.caption,
      color: FILM.textMuted,
    },
    urgentDot: {
      width: 6,
      height: 6,
      borderRadius: radii.full,
      backgroundColor: c.live,
    },
    urgentStatusLine: {
      color: FILM.text,
      fontFamily: fonts.bodySemiBold,
    },
    bandLinkText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: FILM.text,
      textDecorationLine: 'underline',
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.sm,
      marginBottom: spacing.md,
    },
    actionButton: {
      flex: 1,
      height: 44,
      paddingHorizontal: spacing.xs,
    },
    addButton: {
      flexBasis: '100%',
      width: '100%',
      height: 48,
    },
    allowanceRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: spacing.xs,
      marginBottom: spacing.sm,
    },
    allowanceText: {
      ...t.caption,
      color: c.inkMuted,
    },
    allowanceLink: {
      minHeight: 44,
      justifyContent: 'center',
    },
    allowanceLinkText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    notice: {
      ...t.caption,
      color: c.accentText,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.control,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
      textAlign: 'center',
      overflow: 'hidden',
    },
    gridWrap: {
      marginHorizontal: FILM_FRAME,
      marginTop: FILM_FRAME,
      marginBottom: FILM_FRAME - GRID_GAP,
    },
    bandInset: { paddingHorizontal: spacing.lg },
    uniformGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    gridImage: {
      width: '100%',
      height: '100%',
      backgroundColor: c.card,
      borderRadius: 0,
    },
    twoColumnRow: {
      flexDirection: 'row',
      gap: GRID_GAP,
    },
    featureRow: {
      flexDirection: 'row',
      marginBottom: GRID_GAP,
    },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    // One row, the buttons sharing it evenly, with room above and below.
    toolRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xs },
    // Rounded squares like the app's other buttons and the photo frames.
    toolChip: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: FILM.plate,
      borderRadius: radii.control,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      minHeight: 36,
      justifyContent: 'center',
    },
    toolChipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: FILM.text },
    moreTile: {
      backgroundColor: '#000000',
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // A soft shadow keeps the count readable over a busy photo.
    moreCount: {
      fontFamily: fonts.display,
      fontSize: 26,
      color: '#FFFFFF',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowRadius: 6,
    },
    moreLabel: {
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: '#FFFFFF',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowRadius: 6,
    },
    trailingGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    emptyWrap: {
      marginTop: spacing.md,
      marginBottom: spacing.md,
    },
    viewer: {
      flex: 1,
      backgroundColor: c.paper,
    },
    viewerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    viewerMetaBlock: {
      flex: 1,
      marginRight: spacing.md,
    },
    viewerUploader: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      fontSize: 15,
      color: c.ink,
    },
    viewerIndexText: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 12,
      marginTop: 1,
    },
    viewerTopRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
    },
    // ⋯ and ✕: plain icons with a full 44pt target.
    viewerIconBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerCoverTag: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.lg,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radii.tag,
    },
    viewerCoverTagText: { color: '#FFFFFF', fontSize: 12, fontFamily: fonts.bodySemiBold },
    // Over the photo: see-through dark pills that read on any picture,
    // light or dark, in either theme.
    reactionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: spacing.lg,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.sm,
      zIndex: 40,
    },
    reactionPill: {
      minHeight: 44,
      minWidth: 56,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.full,
      borderWidth: 1.5,
      borderColor: 'transparent',
      backgroundColor: 'rgba(0,0,0,0.38)',
    },
    reactionPillOn: {
      borderColor: '#F0997B',
      backgroundColor: 'rgba(240,153,123,0.28)',
    },
    reactionCount: {
      fontSize: 14,
      fontFamily: fonts.bodySemiBold,
      color: '#FFFFFF',
      fontVariant: ['tabular-nums'],
    },
    reactionCountOn: { color: '#FFFFFF' },
    viewerScrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    viewerImage: {
      width: '100%',
      height: '100%',
    },
    viewerCenterArea: {
      flex: 1,
      position: 'relative',
    },
    navArrowBtn: {
      position: 'absolute',
      top: '50%',
      marginTop: -22,
      width: 44,
      height: 44,
      borderRadius: radii.full,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
    },
    navArrowLeft: {
      left: spacing.md,
    },
    navArrowRight: {
      right: spacing.md,
    },
    viewerNotice: {
      ...t.caption,
      color: c.accentText,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.control,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      textAlign: 'center',
      overflow: 'hidden',
    },
    // Report on the left, delete on the right, side by side.
    gridCoverTag: {
      position: 'absolute',
      top: 4,
      left: 4,
      backgroundColor: 'rgba(0,0,0,0.65)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radii.tag,
    },
    gridCoverTagText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontFamily: fonts.bodySemiBold,
      letterSpacing: 0.5,
    },
    sheetOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
    },
    pickerModalScreen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    pickerHeaderLeft: {
      flex: 1,
    },
    pickerTitle: {
      ...t.h3,
      fontFamily: fonts.bodySemiBold,
      fontSize: 18,
      color: c.ink,
    },
    pickerSubtitle: {
      ...t.caption,
      color: c.inkMuted,
      marginTop: 2,
    },
    pickerCloseBtn: {
      padding: 6,
    },
    pickerScrollContent: {
      paddingTop: spacing.sm,
    },
    pickerSelectedImage: {
      borderWidth: 3,
      borderColor: c.accent,
    },
    pickerCheckBadge: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      borderRadius: radii.full,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.3,
      shadowRadius: 2,
    },
    pickerBottomWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerFloatingBtn: {
      height: 48,
      paddingHorizontal: spacing.xl,
      borderRadius: radii.control,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
    },
    pickerFloatingBtnText: {
      ...t.button,
      color: c.onAccent,
      fontFamily: fonts.bodySemiBold,
      fontSize: 15,
    },
  });
};
