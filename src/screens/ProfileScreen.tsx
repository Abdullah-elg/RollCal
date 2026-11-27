// The Profile tab: who you are (tap the photo to change it), and your
// Memories, the events you've been to that have photos, newest first.
// Settings sit behind the gear at the top.

import { useFocusEffect } from '@react-navigation/native';
import { Gear } from 'phosphor-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EditableAvatar from '../components/EditableAvatar';
import { PlayIcon } from '../components/icons';
import { Button, EmptyNote, SectionLabel, SECTION_GAP } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { formatDay } from '../lib/dates';
import { hapticLight } from '../lib/haptics';
import { loadMemories, Memory } from '../lib/memories';
import { anniversaryLabel } from '../lib/memoriesArrange';
import { signedLinks } from '../lib/signedUrls';
import { TabScreenProps } from '../navigation/types';
import { fonts, Palette, radii, spacing, TITLE_MAX_SCALE, TypeTokens } from '../theme';

type Props = TabScreenProps<'ProfileTab'>;

type Tile = Memory & { image: string | null };

const GAP = spacing.md;

export default function ProfileScreen({ navigation }: Props) {
  const { profile } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - spacing.lg * 2 - GAP) / 2);

  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const memories = await loadMemories();
      const links = await signedLinks(
        'event-photos',
        memories.flatMap((m) => (m.coverPath ? [m.coverPath] : []))
      );
      setTiles(
        memories.map((m) => {
          const link = m.coverPath ? links.get(m.coverPath) : undefined;
          // A video's own link isn't a picture; only its still is.
          const image = link ? (link.thumb ?? (m.coverIsVideo ? null : link.url)) : null;
          return { ...m, image };
        })
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    hapticLight();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const photoTotal = tiles?.reduce((n, t) => n + t.photoCount, 0) ?? 0;
  // Memories that come back today (1, 3, 6 months or a whole number of
  // years on), shown big above the grid. They stay in the grid too.
  const fullWidth = width - spacing.lg * 2;
  const comingBack = (tiles ?? []).flatMap((t) => {
    const label = anniversaryLabel(t.startsAt);
    return label ? [{ ...t, label }] : [];
  });
  const openMemory = (eventId: string) =>
    navigation.navigate('EventPhotos', { eventId, fromMemories: true });

  const header = (
    <View>
      <View style={styles.identity}>
        <EditableAvatar size={72} backdrop={colors.paper} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name} numberOfLines={2}>
            {profile?.display_name ?? ' '}
          </Text>
          {profile?.username ? (
            <Text style={type.bodyMuted} numberOfLines={1}>
              @{profile.username}
            </Text>
          ) : null}
        </View>
      </View>
      <Button
        title="Edit profile"
        variant="secondary"
        onPress={() => navigation.navigate('EditProfile')}
        style={styles.editButton}
      />
      <View style={styles.memoriesHead}>
        <SectionLabel style={styles.headLabel}>Memories</SectionLabel>
        {tiles && tiles.length > 0 ? (
          <Text style={type.caption}>
            {tiles.length} {tiles.length === 1 ? 'event' : 'events'} · {photoTotal}{' '}
            {photoTotal === 1 ? 'photo' : 'photos'}
          </Text>
        ) : null}
      </View>
      {comingBack.map((t) => (
        <Pressable
          key={t.eventId}
          onPress={() => openMemory(t.eventId)}
          accessibilityRole="button"
          accessibilityLabel={`${t.label}: ${t.title}, ${formatDay(t.startsAt)}`}
          style={({ pressed }) => [styles.comingBack, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.comingBackLabel}>{t.label}</Text>
          <View style={[styles.picture, { width: fullWidth, height: Math.round(fullWidth * 0.62) }]}>
            {t.image ? (
              <Image source={{ uri: t.image }} style={StyleSheet.absoluteFill} />
            ) : t.coverIsVideo ? (
              <PlayIcon size={28} color={colors.inkMuted} />
            ) : null}
          </View>
          <Text style={styles.tileTitle} numberOfLines={1}>
            {t.title}
          </Text>
          <Text style={type.caption} numberOfLines={1}>
            {formatDay(t.startsAt)} · {t.photoCount} {t.photoCount === 1 ? 'photo' : 'photos'}
          </Text>
        </Pressable>
      ))}
      {/* A line and a heading between today's memories and the rest. */}
      {comingBack.length > 0 ? (
        <View style={styles.restHead}>
          <SectionLabel>All memories</SectionLabel>
        </View>
      ) : null}
    </View>
  );

  const renderTile = ({ item }: { item: Tile }) => (
    <Pressable
      onPress={() => openMemory(item.eventId)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${formatDay(item.startsAt)}, ${item.photoCount} ${
        item.photoCount === 1 ? 'photo' : 'photos'
      }`}
      style={({ pressed }) => [{ width: tileWidth }, pressed && { opacity: 0.8 }]}
    >
      <View style={[styles.picture, { width: tileWidth, height: tileWidth }]}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} />
        ) : item.coverIsVideo ? (
          <PlayIcon size={24} color={colors.inkMuted} />
        ) : null}
      </View>
      <Text style={styles.tileTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={type.caption} numberOfLines={1}>
        {formatDay(item.startsAt)} · {item.photoCount} {item.photoCount === 1 ? 'photo' : 'photos'}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.displayTitle} maxFontSizeMultiplier={TITLE_MAX_SCALE}>Profile</Text>
        <Pressable
          accessibilityLabel="Settings"
          accessibilityRole="button"
          onPress={() => navigation.navigate('Settings')}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] },
          ]}
        >
          <Gear size={24} color={colors.ink} />
        </Pressable>
      </View>

      <FlatList
        data={tiles ?? []}
        keyExtractor={(t) => t.eventId}
        renderItem={renderTile}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={
          tiles === null && !failed ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
          ) : failed ? (
            <View style={{ gap: spacing.md, alignItems: 'flex-start' }}>
              <EmptyNote>Couldn’t load your memories.</EmptyNote>
              <Button title="Try again" variant="secondary" onPress={load} />
            </View>
          ) : (
            <EmptyNote>
              Once an event you went to is over, it lands here with everyone’s photos.
            </EmptyNote>
          )
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.inkMuted} />
        }
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    // Same top bar as Events: big title, one icon on the right.
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs + 15,
      paddingBottom: spacing.sm,
    },
    displayTitle: {
      fontFamily: fonts.display,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.5,
      color: c.ink,
    },
    iconBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'flex-end' },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    editButton: { marginBottom: spacing.lg },
    name: { ...t.title, fontSize: 20, lineHeight: 26 },
    memoriesHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingTop: SECTION_GAP - spacing.md,
    },
    headLabel: { marginBottom: 0 },
    // The photo is the tile: no border or card around it.
    picture: {
      borderRadius: radii.card,
      overflow: 'hidden',
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    tileTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: c.ink },
    comingBack: { marginTop: spacing.md },
    restHead: {
      marginTop: SECTION_GAP,
      // Cancels the list's row gap so the heading sits as close to the grid
      // as "From 1 month ago" does to its photo.
      marginBottom: -spacing.lg,
    },
    comingBackLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 15,
      color: c.ink,
      marginBottom: spacing.sm,
    },
  });
