import { BlurView } from 'expo-blur';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  GestureResponderEvent,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { animateNext } from '../lib/animate';
import { hapticLight, hapticShutter } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Event, Photo } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';
import { Button, EmptyNote } from './ui';

const BUCKET = 'event-photos';
const UPLOAD_WINDOW_MS = 48 * 60 * 60 * 1000;
const GRID_GAP = 2;

export type LoadedPhoto = Photo & {
  url: string | null;
  uploaderName: string;
};

type Props = {
  event: Event;
  isLeader: boolean;
  userId: string;
  refreshSeq: number;
  onPhotosChange?: (photos: LoadedPhoto[]) => void;
  uploadsClosedOverride?: boolean;
  coverPhotoId?: string | null;
  onSetCoverPhoto?: (photoId: string | null) => void;
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

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Analog exposure counter badge modeled on vintage 35mm cameras
function ExposureCounter({ count }: { count: number }) {
  const { colors, mode } = useTheme();
  const formatted = count < 10 ? `0${count}` : String(count);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: mode === 'dark' ? '#25201A' : '#F0EAE1',
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginLeft: spacing.sm,
        gap: 4,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontFamily: fonts.bodySemiBold,
          letterSpacing: 0.8,
          color: colors.inkMuted,
          textTransform: 'uppercase',
        }}
      >
        EXP
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontFamily: fonts.headingMedium,
          color: colors.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatted}
      </Text>
    </View>
  );
}

// Subtle procedural static film grain overlay for album header (0 performance impact)
function FilmGrainHeader() {
  const { mode } = useTheme();
  const dots = useMemo(() => {
    const list: Array<{ x: number; y: number; r: number; o: number }> = [];
    for (let i = 0; i < 48; i++) {
      const x = (i * 37 + 13) % 100;
      const y = (i * 47 + 23) % 100;
      const r = i % 3 === 0 ? 0.7 : 0.45;
      const o = 0.03 + (i % 4) * 0.015;
      list.push({ x, y, r, o });
    }
    return list;
  }, []);

  const dotColor = mode === 'dark' ? '#FFFFFF' : '#000000';

  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      pointerEvents="none"
    >
      {dots.map((d, i) => (
        <Circle
          key={i}
          cx={`${d.x}%`}
          cy={`${d.y}%`}
          r={d.r}
          fill={dotColor}
          opacity={d.o}
        />
      ))}
    </Svg>
  );
}

// Grid photo item with darkroom print developing animation on new uploads
function DevelopingPhotoItem({
  uri,
  style,
  imageStyle,
  isDeveloping,
  onPress,
  children,
}: {
  uri?: string | null;
  style: any;
  imageStyle: any;
  isDeveloping?: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const { mode } = useTheme();
  const anim = useRef(new Animated.Value(isDeveloping ? 0 : 1)).current;

  useEffect(() => {
    if (isDeveloping) {
      Animated.timing(anim, {
        toValue: 1,
        duration: 550,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [isDeveloping, anim]);

  if (!isDeveloping) {
    return (
      <Pressable onPress={onPress} style={style}>
        {uri ? <Image source={{ uri }} style={imageStyle} /> : null}
        {children}
      </Pressable>
    );
  }

  // Darkroom print developing: starts faint & washed out, then deepens into rich color
  const imageOpacity = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.4, 0.8, 1],
  });

  const washOpacity = anim.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.85, 0.35, 0],
  });

  const washColor = mode === 'dark' ? '#2A241C' : '#FFFDF6';

  return (
    <Pressable onPress={onPress} style={[style, { overflow: 'hidden' }]}>
      {uri ? (
        <Animated.Image
          source={{ uri }}
          style={[imageStyle, { opacity: imageOpacity }]}
        />
      ) : null}

      {/* Translucent developing paper wash */}
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

      {/* Dissolving print blur */}
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

export default function EventAlbum({
  event,
  isLeader,
  userId,
  refreshSeq,
  onPhotosChange,
  uploadsClosedOverride,
  coverPhotoId,
  onSetCoverPhoto,
}: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [selectedCoverId, setSelectedCoverId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busySaving, setBusySaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [developingIds, setDevelopingIds] = useState<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);
  const flatListRef = useRef<FlatList<LoadedPhoto>>(null);

  const uploadsClosed =
    uploadsClosedOverride !== undefined ? uploadsClosedOverride : event.uploads_closed;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const now = Date.now();
  const endsAt = new Date(event.ends_at).getTime();
  const windowCloses = endsAt + UPLOAD_WINDOW_MS;
  const withinWindow = now >= endsAt && now <= windowCloses;
  const uploadOpen = withinWindow && !uploadsClosed;
  const beforeEnd = now < endsAt;
  const hoursLeft = Math.max(1, Math.round((windowCloses - now) / (60 * 60 * 1000)));

  const countdownText = useMemo(() => {
    const startsAt = new Date(event.starts_at).getTime();
    if (now < startsAt) {
      return 'Opens when event ends';
    }
    const diffMs = endsAt - now;
    if (diffMs <= 0) return 'Opens shortly';
    const diffHours = Math.round(diffMs / (60 * 60 * 1000));
    if (diffHours < 1) {
      const diffMins = Math.max(1, Math.round(diffMs / (60 * 1000)));
      return `Unlocks in ${diffMins}m`;
    }
    if (diffHours < 24) {
      return `Unlocks in ${diffHours}h`;
    }
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    return `Unlocks in ${diffDays}d`;
  }, [event.starts_at, endsAt, now]);

  const panY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (viewerIndex === null) {
      panY.setValue(0);
    }
  }, [viewerIndex, panY]);

  const touchStartRef = useRef<{ y: number; x: number; time: number } | null>(null);

  const closeViewer = useCallback(() => {
    panY.setValue(0);
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
    const { data: rows } = await supabase
      .from('photos')
      .select('*')
      .eq('event_id', event.id)
      .order('created_at', { ascending: true });
    if (!rows) {
      setLoaded(true);
      return;
    }

    let urlByPath = new Map<string, string>();
    if (rows.length > 0) {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(rows.map((r) => r.storage_path), 3600);
      signed?.forEach((s) => {
        if (s.signedUrl && s.path) urlByPath.set(s.path, s.signedUrl);
      });
    }

    const uploaderIds = [...new Set(rows.map((r) => r.uploader_id))];
    const { data: profiles } =
      uploaderIds.length > 0
        ? await supabase.from('profiles').select('id, display_name').in('id', uploaderIds)
        : { data: [] };

    const loadedList: LoadedPhoto[] = rows.map((r) => ({
      ...r,
      url: urlByPath.get(r.storage_path) ?? null,
      uploaderName:
        profiles?.find((p) => p.id === r.uploader_id)?.display_name ?? 'Someone',
    }));

    animateNext(hasLoadedRef.current);
    setPhotos(loadedList);
    onPhotosChange?.(loadedList);
    setLoaded(true);
    hasLoadedRef.current = true;
  }, [event.id, onPhotosChange]);

  useEffect(() => {
    load();
  }, [load, refreshSeq]);

  const addPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || result.assets.length === 0) return;

    let done = 0;
    const newUploadedIds: string[] = [];
    setUploading(`0/${result.assets.length}`);
    for (const asset of result.assets) {
      try {
        if (!asset.base64) continue;
        const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
        const path = `${event.id}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, base64ToArrayBuffer(asset.base64), {
            contentType: asset.mimeType ?? 'image/jpeg',
          });
        if (uploadError) throw new Error(uploadError.message);
        const { data: rowData, error: rowError } = await supabase
          .from('photos')
          .insert({ event_id: event.id, uploader_id: userId, storage_path: path })
          .select('id')
          .single();
        if (rowError) throw new Error(rowError.message);
        if (rowData?.id) newUploadedIds.push(rowData.id);
        done += 1;
        setUploading(`${done}/${result.assets.length}`);
      } catch (err) {
        Alert.alert(
          'Upload failed',
          err instanceof Error ? err.message : 'Something went wrong.'
        );
        break;
      }
    }
    setUploading(null);
    if (newUploadedIds.length > 0) {
      hapticShutter();
      setDevelopingIds(new Set(newUploadedIds));
      setTimeout(() => {
        setDevelopingIds(new Set());
      }, 1500);
    } else {
      hapticLight();
    }
    load();
  };

  const saveToDevice = async (photo: LoadedPhoto): Promise<boolean> => {
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) {
      Alert.alert(
        'Saving unavailable',
        "This build can't reach your photo library. Viewing the album still works."
      );
      return false;
    }
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to save pictures.');
      return false;
    }
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(photo.storage_path, 300);
    if (!data) return false;
    const filename = photo.storage_path.split('/').pop() ?? 'photo.jpg';
    const target = new File(Paths.cache, filename);
    if (target.exists) target.delete();
    const downloaded = await File.downloadFileAsync(data.signedUrl, target);
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
      Alert.alert('Save failed', 'Could not save this photo.');
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
            ? 'Photo saved to your camera roll.'
            : `All ${done} photos saved to your camera roll.`
        );
      }
    } catch {
      Alert.alert('Save failed', `Saved ${done} of ${photos.length} photos.`);
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

  const msLeft = windowCloses - now;
  const isUrgentWindow = uploadOpen && msLeft > 0 && msLeft <= 3 * 60 * 60 * 1000;
  const minutesLeft = Math.max(1, Math.round(msLeft / (60 * 1000)));
  const timeLeftText = hoursLeft <= 1 ? `${minutesLeft} minutes` : `${hoursLeft} hours`;

  const uniqueUploaderCount = useMemo(
    () => new Set(photos.map((p) => p.uploader_id)).size,
    [photos]
  );
  const peopleCount = Math.max(1, uniqueUploaderCount);

  let statusLine = '';
  let mutedSummaryLine: string | null = null;

  if (beforeEnd) {
    statusLine = 'The roll opens when the event ends.';
  } else if (uploadOpen) {
    statusLine = `The roll is open. ${timeLeftText} left.`;
  } else if (withinWindow && uploadsClosed) {
    statusLine = isLeader ? 'The roll was closed early.' : 'The host closed the roll.';
    if (photos.length > 0) {
      mutedSummaryLine = `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}. ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}.`;
    }
  } else {
    // Roll is closed
    if (photos.length > 0) {
      statusLine = `Roll closed. ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}.`;
      mutedSummaryLine = `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}. ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}.`;
    } else {
      statusLine = 'Roll closed. No photos taken.';
    }
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

  const openCoverPicker = () => {
    setSelectedCoverId(coverPhotoId ?? null);
    setShowCoverPicker(true);
  };

  const viewerList = displayPhotos;
  const viewerPhoto = viewerIndex !== null ? viewerList[viewerIndex] : null;
  const canDeleteViewer =
    viewerPhoto != null && (isLeader || viewerPhoto.uploader_id === userId);

  // Layout calculations for edge-to-edge grid with 2px gaps
  const colWidth = Math.floor((screenWidth - GRID_GAP * 2) / 3);
  const featureSize = colWidth * 2 + GRID_GAP;
  const sideRemainingWidth = screenWidth - featureSize - GRID_GAP;

  return (
    <View style={styles.container}>
      {/* Album Header with subtle film grain */}
      <View style={styles.headerRow}>
        <FilmGrainHeader />
        <View style={styles.titleWrap}>
          <Text style={styles.sectionTitle}>Photos</Text>
          {photos.length > 0 && <ExposureCounter count={photos.length} />}
        </View>
        {photos.length > 0 && !beforeEnd && (
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
        )}
      </View>

      {beforeEnd ? (
        <View style={styles.canisterCard}>
          <View style={styles.canisterHeader}>
            <View style={styles.canisterExposureBadge}>
              <Text style={styles.canisterExpLabel}>EXP</Text>
              <Text style={styles.canisterExpNumber}>00</Text>
            </View>
            <View style={styles.canisterCountdownPill}>
              <Text style={styles.canisterCountdownText}>{countdownText}</Text>
            </View>
          </View>
          <Text style={styles.canisterSubtext}>
            The shared roll is sealed until the event ends. Once it wraps up, everyone can drop in their shots.
          </Text>
        </View>
      ) : (
        <View style={styles.statusWrap}>
          <View style={styles.statusLineRow}>
            {isUrgentWindow && <View style={styles.urgentDot} />}
            <Text style={[styles.statusLine, isUrgentWindow && styles.urgentStatusLine]}>
              {statusLine}
            </Text>
          </View>
          {mutedSummaryLine && (
            <Text style={styles.mutedSummaryLine}>{mutedSummaryLine}</Text>
          )}
        </View>
      )}

      {/* Action Buttons: Add photos (terracotta primary) & Set event photo for host */}
      {(uploadOpen || (isLeader && photos.length > 0)) && (
        <View style={styles.actionRow}>
          {uploadOpen && (
            <Button
              title={uploading ? `Uploading ${uploading}…` : 'Add photos'}
              onPress={addPhotos}
              disabled={uploading !== null}
              style={styles.actionButton}
            />
          )}
          {isLeader && photos.length > 0 && (
            <Button
              title={hasCover ? 'Change event photo' : 'Set event photo'}
              variant="secondary"
              onPress={openCoverPicker}
              style={styles.actionButton}
            />
          )}
        </View>
      )}

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {/* Edge-to-edge photo grid */}
      {!loaded ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
      ) : displayPhotos.length > 0 ? (
        <View style={[styles.gridWrap, { width: screenWidth }]}>
          {!hasCover ? (
            /* Uniform 3-column square grid: all photos same equal size, none bigger than the other */
            <View style={styles.uniformGrid}>
              {displayPhotos.map((photo, index) => {
                const colIndex = index % 3;
                const isLastInRow = colIndex === 2;
                return (
                  <DevelopingPhotoItem
                    key={photo.id}
                    uri={photo.url}
                    imageStyle={styles.gridImage}
                    isDeveloping={developingIds.has(photo.id)}
                    onPress={() => setViewerIndex(index)}
                    style={{
                      width: colWidth,
                      height: colWidth,
                      marginRight: isLastInRow ? 0 : GRID_GAP,
                      marginBottom: GRID_GAP,
                    }}
                  />
                );
              })}
            </View>
          ) : displayPhotos.length === 1 ? (
            /* Single cover photo */
            <DevelopingPhotoItem
              uri={displayPhotos[0].url}
              imageStyle={styles.gridImage}
              isDeveloping={developingIds.has(displayPhotos[0].id)}
              onPress={() => setViewerIndex(0)}
              style={{ width: screenWidth, height: Math.round(screenWidth * 0.75) }}
            >
              <View style={styles.gridCoverTag}>
                <Text style={styles.gridCoverTagText}>Cover</Text>
              </View>
            </DevelopingPhotoItem>
          ) : displayPhotos.length === 2 ? (
            /* 2 photos with cover featured */
            <View style={[styles.featureRow, { height: featureSize }]}>
              <DevelopingPhotoItem
                uri={displayPhotos[0].url}
                imageStyle={styles.gridImage}
                isDeveloping={developingIds.has(displayPhotos[0].id)}
                onPress={() => setViewerIndex(0)}
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
                uri={displayPhotos[1].url}
                imageStyle={styles.gridImage}
                isDeveloping={developingIds.has(displayPhotos[1].id)}
                onPress={() => setViewerIndex(1)}
                style={{
                  width: sideRemainingWidth,
                  height: featureSize,
                }}
              />
            </View>
          ) : (
            // 3 or more photos: Cover photo is the 2x2 featured big one that pops up first!
            <>
              <View style={[styles.featureRow, { height: featureSize }]}>
                {/* 2x2 Feature photo (Cover) */}
                <DevelopingPhotoItem
                  uri={displayPhotos[0].url}
                  imageStyle={styles.gridImage}
                  isDeveloping={developingIds.has(displayPhotos[0].id)}
                  onPress={() => setViewerIndex(0)}
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

                {/* Stack of 2 side photos */}
                <View
                  style={{
                    width: sideRemainingWidth,
                    height: featureSize,
                    justifyContent: 'space-between',
                  }}
                >
                  <DevelopingPhotoItem
                    uri={displayPhotos[1].url}
                    imageStyle={styles.gridImage}
                    isDeveloping={developingIds.has(displayPhotos[1].id)}
                    onPress={() => setViewerIndex(1)}
                    style={{ width: sideRemainingWidth, height: colWidth }}
                  />
                  <DevelopingPhotoItem
                    uri={displayPhotos[2].url}
                    imageStyle={styles.gridImage}
                    isDeveloping={developingIds.has(displayPhotos[2].id)}
                    onPress={() => setViewerIndex(2)}
                    style={{ width: sideRemainingWidth, height: colWidth }}
                  />
                </View>
              </View>

              {/* Photos from index 3 onward */}
              {displayPhotos.length > 3 && (
                <View style={styles.trailingGrid}>
                  {displayPhotos.slice(3).map((photo, idx) => {
                    const realIndex = idx + 3;
                    const colIndex = idx % 3;
                    const isLastInRow = colIndex === 2;
                    return (
                      <DevelopingPhotoItem
                        key={photo.id}
                        uri={photo.url}
                        imageStyle={styles.gridImage}
                        isDeveloping={developingIds.has(photo.id)}
                        onPress={() => setViewerIndex(realIndex)}
                        style={{
                          width: colWidth,
                          height: colWidth,
                          marginRight: isLastInRow ? 0 : GRID_GAP,
                          marginBottom: GRID_GAP,
                        }}
                      />
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>
      ) : uploadOpen ? (
        <View style={styles.emptyWrap}>
          <EmptyNote>No photos yet. Somebody take one.</EmptyNote>
        </View>
      ) : null}

      {/* Full-screen photo viewer: swipe, left/right arrows, pinch-to-zoom, uploader name, save button in corner */}
      <Modal
        visible={viewerPhoto !== null}
        animationType="fade"
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={closeViewer}
      >
        {viewerPhoto && (
          <SafeAreaView
            style={styles.viewer}
            edges={Platform.OS === 'android' ? ['bottom'] : ['top', 'bottom']}
          >
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
              {/* Top Bar */}
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
                  onPress={() => saveOne(viewerPhoto)}
                  disabled={busySaving}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.viewerCornerSave,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.viewerCornerSaveText}>
                    {busySaving ? 'Saving…' : 'Save'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={closeViewer}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.viewerCloseBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <CloseIcon size={20} color={colors.ink} />
                </Pressable>
              </View>
            </View>

            {/* Horizontal paging FlatList with pinch-to-zoom ScrollViews + Floating Nav Arrows */}
            <View style={styles.viewerCenterArea}>
              <FlatList
                ref={flatListRef}
                data={viewerList}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(p) => p.id}
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
                renderItem={({ item }) =>
                  Platform.OS === 'ios' ? (
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

              {/* Left arrow button */}
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

              {/* Right arrow button */}
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
            </View>

            {notice && <Text style={styles.viewerNotice}>{notice}</Text>}

            {/* Bottom Bar with Set as cover photo (for host) and Delete photo */}
            {(isLeader || canDeleteViewer) && (
              <View style={styles.viewerBottom}>
                {isLeader && (
                  <Pressable
                    onPress={() => toggleCoverPhoto(viewerPhoto.id)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.viewerCoverAction,
                      viewerPhoto.id === coverPhotoId &&
                        styles.viewerCoverActionActiveWrap,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.viewerCoverActionText,
                        viewerPhoto.id === coverPhotoId &&
                          styles.viewerCoverActionActive,
                      ]}
                    >
                      {viewerPhoto.id === coverPhotoId
                        ? '✓ Event photo · tap to remove'
                        : 'Set as event photo'}
                    </Text>
                  </Pressable>
                )}
                {canDeleteViewer && (
                  <Pressable
                    onPress={() => setConfirmDeleteId(viewerPhoto.id)}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.viewerDelete}>Delete photo</Text>
                  </Pressable>
                )}
              </View>
            )}
            </Animated.View>
          </SafeAreaView>
        )}
      </Modal>

      {/* Cover Photo Selection Modal */}
      <Modal
        visible={showCoverPicker}
        animationType="slide"
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
            {/* Modal Header */}
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

            {/* Scrollable grid of photos */}
            <ScrollView
              contentContainerStyle={[
                styles.pickerScrollContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 72 },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.uniformGrid, { width: screenWidth }]}>
                {photos.map((photo, index) => {
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
                        source={{ uri: photo.url ?? undefined }}
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

            {/* Floating pop-up button at the bottom middle of the screen */}
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

      <ConfirmDialog
        visible={confirmDeleteId !== null}
        title="Delete this photo?"
        message="It comes out of the album for everyone."
        confirmLabel="Delete"
        destructive
        onConfirm={deletePhoto}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    container: {
      marginTop: spacing.md,
    },
    headerRow: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
      borderRadius: radii.sm,
      overflow: 'hidden',
    },
    titleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    sectionTitle: {
      fontSize: 15,
      fontFamily: fonts.body,
      color: c.inkMuted,
    },
    countText: {
      fontSize: 15,
      fontFamily: fonts.body,
      color: c.inkMuted,
    },
    saveAllText: {
      ...t.body,
      fontSize: 14,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    canisterCard: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.md,
      padding: spacing.md,
      marginTop: spacing.xs,
      marginBottom: spacing.md,
      gap: spacing.xs,
    },
    canisterHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    canisterExposureBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.paper,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.sm,
      paddingHorizontal: 7,
      paddingVertical: 3,
      gap: 4,
    },
    canisterExpLabel: {
      fontSize: 9,
      fontFamily: fonts.bodySemiBold,
      letterSpacing: 0.8,
      color: c.inkMuted,
      textTransform: 'uppercase',
    },
    canisterExpNumber: {
      fontSize: 12,
      fontFamily: fonts.headingMedium,
      color: c.ink,
      fontVariant: ['tabular-nums'],
    },
    canisterCountdownPill: {
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.full,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    canisterCountdownText: {
      ...t.caption,
      fontSize: 11,
      fontFamily: fonts.bodyMedium,
      color: c.accent,
    },
    canisterSubtext: {
      ...t.caption,
      color: c.inkMuted,
      lineHeight: 16,
      marginTop: 2,
    },
    statusWrap: {
      marginTop: 4,
      marginBottom: spacing.sm,
      gap: 2,
    },
    statusLineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusLine: {
      ...t.caption,
      color: c.inkMuted,
    },
    urgentDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.accent,
    },
    urgentStatusLine: {
      color: c.accentText,
      fontFamily: fonts.bodySemiBold,
    },
    mutedSummaryLine: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 13,
    },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.xs,
      marginBottom: spacing.md,
    },
    actionButton: {
      flex: 1,
      height: 44,
      paddingHorizontal: spacing.xs,
    },
    notice: {
      ...t.caption,
      color: c.accentText,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
      textAlign: 'center',
      overflow: 'hidden',
    },
    gridWrap: {
      marginHorizontal: -spacing.lg,
      marginTop: spacing.xs,
    },
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
    viewerCornerSave: {
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    viewerCornerSaveText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: c.ink,
    },
    viewerCloseBtn: {
      padding: 4,
    },
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
      borderRadius: 22,
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
      borderRadius: radii.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      textAlign: 'center',
      overflow: 'hidden',
    },
    viewerBottom: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    viewerCoverAction: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 20,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    viewerCoverActionActiveWrap: {
      borderColor: c.accent,
    },
    viewerCoverActionText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: c.ink,
    },
    viewerCoverActionActive: {
      color: c.accentText,
    },
    viewerDelete: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.danger,
    },
    gridCoverTag: {
      position: 'absolute',
      top: 4,
      left: 4,
      backgroundColor: 'rgba(0,0,0,0.65)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    gridCoverTagText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontFamily: fonts.bodySemiBold,
      letterSpacing: 0.5,
    },
    sheetOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
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
      borderRadius: 11,
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
      borderRadius: 24,
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
