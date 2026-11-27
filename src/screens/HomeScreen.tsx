// The Events tab. Groups the user's events by when they happen, with a hero
// card for the next one this week. Events from the last load stay on screen
// with a note if the server can't be reached.

import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import Avatar from '../components/Avatar';
import { BellIcon, ChevronRightIcon } from '../components/icons';
import { Button, SectionLabel, SECTION_GAP } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { animateNext } from '../lib/animate';
import { hapticLight } from '../lib/haptics';
import { loadInbox } from '../lib/inbox';
import {
  dayOfMonth,
  formatDay,
  formatLiveCountdown,
  formatTime,
  monthShort,
} from '../lib/dates';
import {
  loadPendingInvitations,
  PendingInvitation,
} from '../lib/invitations';
import {
  notifyBillPayments,
  notifyBillsShared,
  notifyChatMessages,
  notifyEventInvitations,
  syncEventReminders,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { TabScreenProps } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Event } from '../types';
import { signedLinks, signedUrls } from '../lib/signedUrls';
import { loadMemories } from '../lib/memories';
import { eventInitial, isLiveNow, pickMemoryStrip } from '../lib/homeEvents';
import { placeLabel } from '../lib/place';
import { daysLeft, loadPhotoExpiry, WARN_DAYS } from '../lib/expiry';

type Props = TabScreenProps<'HomeTab'>;

type MemoryTile = { eventId: string; title: string; image: string };
// A past event whose photos are deleted within a week.
type ExpiringTile = MemoryTile & { days: number };

type EventMeta = {
  photoCount: number;
  coverUrl?: string;
  // The host's cover, else the event's first photo (upcoming events only).
  imageUrl?: string;
  goingCount: number;
  attendees: Array<{ userId: string; name: string; avatarUrl?: string | null }>;
};

type EventSection = {
  title: string;
  type: 'upcoming' | 'past';
  data: Event[];
};

// Whether an event runs into a later day. The date beside a row is when it
// starts, so the row adds where it ends ("10:00 PM → Oct 25"), only then.
function endsOnLaterDay(event: { starts_at: string; ends_at: string }): boolean {
  return new Date(event.starts_at).toDateString() !== new Date(event.ends_at).toDateString();
}

export default function HomeScreen({ navigation }: Props) {
  const { profile, session } = useAuth();
  const userId = session!.user.id;
  const { colors, type } = useTheme();
  const { unreadChats, unreadPhotos, hostReports, refresh: refreshUnread } = useUnread();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  const [events, setEvents] = useState<Event[]>([]);
  const [invites, setInvites] = useState<PendingInvitation[]>([]);
  // Unseen notifications, for the number on the bell.
  const [inboxNew, setInboxNew] = useState(0);
  const [metaMap, setMetaMap] = useState<Record<string, EventMeta>>({});
  const [memoryTiles, setMemoryTiles] = useState<MemoryTile[]>([]);
  const [expiringTiles, setExpiringTiles] = useState<ExpiringTile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // The last load couldn't reach the server. Events from an earlier load
  // stay on screen with a note; with none, the list offers to try again.
  const [loadError, setLoadError] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [{ data, error }, pending] = await Promise.all([
        supabase.from('events').select('*').order('starts_at', { ascending: true }),
        loadPendingInvitations(userId),
      ]);

      setInvites(pending);
      notifyEventInvitations(userId, pending);

      setLoadError(!!error || !data);
      if (!error && data) {
        setEvents(data);
        syncEventReminders();
        const eventList = data.map((e) => ({ id: e.id, title: e.title }));
        notifyChatMessages(userId, eventList);
        notifyBillsShared(userId, eventList);
        notifyBillPayments(userId, eventList);

        const eventIds = data.map((e) => e.id);
        if (eventIds.length > 0) {
          const [{ data: photosData }, { data: rsvpsData }] = await Promise.all([
            supabase
              .from('photos')
              .select('id, event_id, storage_path, created_at, kind')
              .in('event_id', eventIds)
              .order('created_at', { ascending: true }),
            supabase
              .from('rsvps')
              .select('event_id, status, user_id')
              .in('event_id', eventIds)
              .eq('status', 'going'),
          ]);

          const photoCountByEvent: Record<string, number> = {};
          photosData?.forEach((p) => {
            photoCountByEvent[p.event_id] = (photoCountByEvent[p.event_id] ?? 0) + 1;
          });


          const userIdsToFetch = Array.from(
            new Set([
              ...data.map((e) => e.creator_id),
              ...(rsvpsData?.map((r) => r.user_id) ?? []),
            ])
          ).filter(Boolean);

          const profileInfoMap = new Map<string, { name: string; avatarUrl?: string | null }>();
          if (userIdsToFetch.length > 0) {
            const { data: profilesData } = await supabase
              .from('profiles')
              .select('id, display_name, avatar_url')
              .in('id', userIdsToFetch);
            profilesData?.forEach((p) => {
              if (p.id) {
                profileInfoMap.set(p.id, {
                  name: p.display_name || 'Someone',
                  avatarUrl: p.avatar_url,
                });
              }
            });
          }

          // Storage paths of the covers hosts have chosen
          const chosenCoverPaths: string[] = [];
          data.forEach((e) => {
            const chosenId = e.cover_photo_id;
            if (chosenId) {
              const photo = photosData?.find(
                (p) => p.id === chosenId && p.event_id === e.id
              );
              if (photo) {
                chosenCoverPaths.push(photo.storage_path);
              }
            }
          });

          // Events still to come with no chosen cover show their first photo.
          const nowMs = Date.now();
          const firstPathByEvent = new Map<string, string>();
          data.forEach((e) => {
            if (new Date(e.ends_at).getTime() < nowMs) return;
            const first = photosData?.find((p) => p.event_id === e.id && p.kind === 'photo');
            if (first) {
              firstPathByEvent.set(e.id, first.storage_path);
              chosenCoverPaths.push(first.storage_path);
            }
          });

          // Reused links (lib/signedUrls), so a cover downloaded once comes
          // from the phone's cache after that instead of downloading again.
          const signedUrlMap = await signedUrls('event-photos', chosenCoverPaths);
          signedUrlMap.forEach((url) => {
            Image.prefetch(url).catch(() => {});
          });

          const newMeta: Record<string, EventMeta> = {};
          data.forEach((e) => {
            const count = photoCountByEvent[e.id] ?? 0;
            const chosenId = e.cover_photo_id;
            let url: string | undefined = undefined;
            if (chosenId) {
              const photo = photosData?.find(
                (p) => p.id === chosenId && p.event_id === e.id
              );
              if (photo) {
                url = signedUrlMap.get(photo.storage_path);
              }
            }

            const eventRsvps = rsvpsData?.filter((r) => r.event_id === e.id) ?? [];
            const attendeeList: Array<{
              userId: string;
              name: string;
              avatarUrl?: string | null;
            }> = [];
            if (e.creator_id) {
              const hostInfo = profileInfoMap.get(e.creator_id);
              attendeeList.push({
                userId: e.creator_id,
                name: hostInfo?.name || 'Host',
                avatarUrl: hostInfo?.avatarUrl,
              });
            }
            eventRsvps.forEach((r) => {
              if (r.user_id && r.user_id !== e.creator_id) {
                if (!attendeeList.some((a) => a.userId === r.user_id)) {
                  const guestInfo = profileInfoMap.get(r.user_id);
                  attendeeList.push({
                    userId: r.user_id,
                    name: guestInfo?.name || 'Guest',
                    avatarUrl: guestInfo?.avatarUrl,
                  });
                }
              }
            });

            const going = Math.max(1, attendeeList.length);

            newMeta[e.id] = {
              photoCount: count,
              coverUrl: url, // undefined unless explicitly chosen by the host!
              imageUrl:
                url ??
                (firstPathByEvent.has(e.id)
                  ? signedUrlMap.get(firstPathByEvent.get(e.id)!)
                  : undefined),
              goingCount: going,
              attendees: attendeeList,
            };
          });

          setMetaMap(newMeta);
        }
      }
    } catch {
      // Offline, or the request died partway.
      setLoadError(true);
    }

    animateNext(hasLoadedRef.current);
    setLoaded(true);
    hasLoadedRef.current = true;
    refreshUnread();
  }, [userId, refreshUnread]);

  const loadStrip = useCallback(async () => {
    try {
      const all = await loadMemories();
      // Photos about to be deleted, soonest first.
      const expiry = await loadPhotoExpiry(all.map((m) => m.eventId));
      const soon = all
        .map((m) => ({ m, e: expiry[m.eventId] }))
        .filter(({ e }) => e?.expiresAt && !e.expiredAt && daysLeft(e.expiresAt) <= WARN_DAYS)
        .sort((a, b) => a.e!.expiresAt!.localeCompare(b.e!.expiresAt!))
        .slice(0, 8);
      // Shown once: what's expiring isn't repeated under memories.
      const soonIds = new Set(soon.map(({ m }) => m.eventId));
      const picked = pickMemoryStrip(all.filter((m) => !soonIds.has(m.eventId)), 6);
      const links = await signedLinks(
        'event-photos',
        [...picked, ...soon.map(({ m }) => m)].flatMap((m) => (m.coverPath ? [m.coverPath] : []))
      );
      const expiring: ExpiringTile[] = [];
      soon.forEach(({ m, e }) => {
        const link = m.coverPath ? links.get(m.coverPath) : undefined;
        const image = link ? (link.thumb ?? (m.coverIsVideo ? null : link.url)) : null;
        if (image) expiring.push({ eventId: m.eventId, title: m.title, image, days: daysLeft(e!.expiresAt!) });
      });
      setExpiringTiles(expiring);
      const tiles: MemoryTile[] = [];
      picked.forEach((m) => {
        const link = m.coverPath ? links.get(m.coverPath) : undefined;
        const image = link ? (link.thumb ?? (m.coverIsVideo ? null : link.url)) : null;
        if (image) tiles.push({ eventId: m.eventId, title: m.title, image });
      });
      setMemoryTiles(tiles);
    } catch {
      // The strip is a bonus; hide it quietly.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      loadStrip();
      loadInbox(userId)
        .then((inbox) => setInboxNew(inbox.fresh.length))
        .catch(() => {});
    }, [load, loadStrip, userId])
  );

  const retry = async () => {
    hapticLight();
    setRetrying(true);
    await load();
    setRetrying(false);
  };

  const onRefresh = async () => {
    hapticLight();
    setRefreshing(true);
    await Promise.all([load(), loadStrip()]);
    setRefreshing(false);
  };

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const weekAgo = now - sevenDaysMs;
  const invitedIds = useMemo(() => new Set(invites.map((i) => i.event.id)), [invites]);
  // A photo reported to you as host keeps its event's dot until you deal with it.
  const unreadSet = useMemo(
    () => new Set([...unreadChats, ...unreadPhotos, ...hostReports.map((r) => r.event_id)]),
    [unreadChats, unreadPhotos, hostReports]
  );

  const visible = useMemo(
    () =>
      events.filter(
        (e) =>
          !invitedIds.has(e.id) &&
          (new Date(e.ends_at).getTime() >= weekAgo || unreadSet.has(e.id))
      ),
    [events, invitedIds, weekAgo, unreadSet]
  );

  const upcomingAll = useMemo(
    () => visible.filter((e) => new Date(e.ends_at).getTime() >= now),
    [visible, now]
  );

  const past = useMemo(
    () =>
      visible
        .filter((e) => new Date(e.ends_at).getTime() < now)
        // By start, newest first: the date beside each one is its start.
        .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
    [visible, now]
  );

  // Any ended event at all (Home hides ones older than a week), so the empty
  // state can tell someone with history from a brand new user.
  const hasPastEvents = useMemo(
    () =>
      events.some(
        (e) => !invitedIds.has(e.id) && new Date(e.ends_at).getTime() < now
      ),
    [events, invitedIds, now]
  );

  const sections = useMemo<EventSection[]>(() => {
    const list: EventSection[] = [];

    if (upcomingAll.length > 0) {
      list.push({
        title: 'Coming up',
        type: 'upcoming',
        data: upcomingAll,
      });
    }

    if (past.length > 0) {
      list.push({
        title: 'Past',
        type: 'past',
        data: past,
      });
    }

    return list;
  }, [upcomingAll, past]);

  const isPhotoCard = (event: Event | undefined, section: EventSection) => {
    const meta = event && metaMap[event.id];
    return section.type === 'past' && !!meta && meta.photoCount > 0 && !!meta.coverUrl;
  };

  const openEvent = (eventId: string) => {
    hapticLight();
    navigation.navigate('EventDetail', { eventId });
  };

  const openMemory = (eventId: string) => {
    hapticLight();
    navigation.navigate('EventPhotos', { eventId, fromMemories: true });
  };

  const memoryStrip =
    memoryTiles.length > 0 || expiringTiles.length > 0 ? (
      <>
        {expiringTiles.length > 0 && <ExpiringStrip tiles={expiringTiles} onOpen={openMemory} />}
        {memoryTiles.length > 0 && <MemoryStrip tiles={memoryTiles} onOpen={openMemory} />}
      </>
    ) : null;

  const renderItem = ({
    item,
    section,
  }: {
    item: Event;
    section: EventSection;
  }) => {
    const event = item;
    const meta = metaMap[event.id];
    const hasUnread = unreadSet.has(event.id);
    const isPast = section.type === 'past';
    if (!isPast) {
      return (
        <EventCard
          key={`card-${event.id}`}
          event={event}
          meta={meta}
          hasUnread={hasUnread}
          onPress={() => openEvent(event.id)}
        />
      );
    }
    // Past events with a chosen cover get a wide photo card. The two kinds of
    // card have different keys so switching builds a new view: Android can
    // keep the old shape's clipping when a view gains overflow: hidden in
    // place, which hid the whole photo card, leaving a blank box.
    if (meta?.coverUrl && isPhotoCard(event, section)) {
      return (
        <Pressable
          key={`photo-${event.id}`}
          style={({ pressed }) => [
            styles.photoCard,
            pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
          ]}
          onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
        >
          <Image source={{ uri: meta.coverUrl }} style={styles.photoCardImage} />
          {/* Drawn over the whole card (clear on the top half) rather than as a
              strip pinned to the bottom, which could leave a sliver of photo
              showing under it after pixel rounding. */}
          <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <SvgLinearGradient id={`grad-${event.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0.5" stopColor="#000000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000000" stopOpacity="0.75" />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#grad-${event.id})`} />
          </Svg>

          <View style={styles.photoCardContent}>
            <Text style={styles.photoCardTitle} numberOfLines={1}>
              {event.title}
            </Text>
            <Text style={styles.photoCountLabel}>
              {new Date(event.starts_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}{' '}
              ·{' '}
              {meta.photoCount} {meta.photoCount === 1 ? 'photo' : 'photos'}
            </Text>
          </View>

          {hasUnread && <View style={styles.cardUnreadDot} />}
        </Pressable>
      );
    }

    return (
      <Pressable
        key={`row-${event.id}`}
        style={({ pressed }) => [
          styles.row,
          pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
      >
        <View style={styles.dateBlock}>
          <Text style={[styles.dateDay, isPast && styles.quieterText]}>
            {dayOfMonth(event.starts_at)}
          </Text>
          <Text style={[styles.dateMonth, isPast && styles.quieterText]}>
            {monthShort(event.starts_at).toUpperCase()}
          </Text>
        </View>

        <View style={styles.rowContent}>
          <Text
            style={styles.rowTitle}
            numberOfLines={1}
          >
            {event.title}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {formatTime(event.starts_at)}
            {endsOnLaterDay(event)
              ? ` → ${new Date(event.ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
              : ''}
            {' · '}
            {meta?.goingCount ?? 1} {isPast ? 'went' : 'going'}
          </Text>
        </View>

        {hasUnread && <View style={styles.rowUnreadDot} />}
        <ChevronRightIcon size={16} color={colors.inkMuted} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.greetingText}>Hey, {profile?.first_name || profile?.display_name || '…'}</Text>
        <View style={styles.titleRow}>
          <Text style={styles.displayTitle} numberOfLines={2}>
            Your events
          </Text>
          <Pressable
            accessibilityLabel={inboxNew > 0 ? `Notifications, ${inboxNew} new` : 'Notifications'}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Notifications')}
            hitSlop={4}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] },
            ]}
          >
            <View style={styles.bellInner}>
              <BellIcon size={22} color={colors.ink} />
              {inboxNew > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {inboxNew > 9 ? '9+' : inboxNew}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        </View>
      </View>

      {!loaded ? (
        <View style={styles.skeletonContainer}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <View style={styles.skeletonDate} />
              <View style={styles.skeletonContent}>
                <View style={styles.skeletonTitle} />
                <View style={styles.skeletonSubtitle} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <SectionList
          sections={sections}
          stickySectionHeadersEnabled={false}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={
            <>
              {loadError && (events.length > 0 || invites.length > 0) && (
                <View style={styles.staleNote}>
                  <Text style={styles.staleText}>Couldn’t refresh. You may be offline.</Text>
                  <Pressable
                    onPress={retry}
                    disabled={retrying}
                    hitSlop={12}
                    accessibilityRole="button"
                  >
                    <Text style={styles.staleAction}>{retrying ? 'Trying…' : 'Try again'}</Text>
                  </Pressable>
                </View>
              )}
              {upcomingAll.length >= 2 && (
                <StoriesRow
                  events={upcomingAll}
                  metaMap={metaMap}
                  unreadSet={unreadSet}
                  onOpen={openEvent}
                />
              )}
            </>
          }
          renderSectionHeader={({ section: { title } }) => (
            <SectionLabel style={styles.sectionHeaderWrap}>{title}</SectionLabel>
          )}
          ItemSeparatorComponent={({ leadingItem, trailingItem, section }) =>
            // Photo cards carry their own edges, so no hairline next to them.
            isPhotoCard(leadingItem, section) || isPhotoCard(trailingItem, section) ? (
              <View style={styles.cardGap} />
            ) : (
              <View style={styles.rowDivider} />
            )
          }
          // Space after each section only (a SectionSeparator also lands
          // between a heading and its first row).
          // The last section has nothing under it but the strips, which
          // bring their own top space; adding more doubled the gap.
          renderSectionFooter={({ section }) =>
            section === sections[sections.length - 1] ? null : <View style={styles.sectionSpacer} />
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + spacing.xxl },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.card}
            />
          }
          ListFooterComponent={sections.length > 0 ? memoryStrip : null}
          ListEmptyComponent={
            loadError ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>Can’t reach RollCal</Text>
                <Text style={styles.emptyText}>Check your connection and try again.</Text>
                <Button
                  title="Try again"
                  onPress={retry}
                  loading={retrying}
                  style={styles.emptyButton}
                />
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {hasPastEvents ? 'Nothing coming up.' : 'No events yet.'}
                </Text>
                <Button
                  title="Plan something"
                  onPress={() => navigation.navigate('CreateEvent')}
                  style={styles.emptyButton}
                />
                {hasPastEvents && (
                  <Pressable
                    onPress={() => navigation.navigate('ProfileTab')}
                    hitSlop={8}
                    accessibilityRole="link"
                  >
                    <Text style={styles.emptyLink}>See your memories</Text>
                  </Pressable>
                )}
                {hasPastEvents && memoryStrip}
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return reduce;
}

// An image that fades in once it has loaded.
function FadeImage({ uri, style }: { uri: string; style: any }) {
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <Animated.Image
      source={{ uri }}
      style={[style, { opacity }]}
      onLoad={() => {
        if (reduce) opacity.setValue(1);
        else Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      }}
    />
  );
}

function StoriesRow({
  events,
  metaMap,
  unreadSet,
  onOpen,
}: {
  events: Event[];
  metaMap: Record<string, EventMeta>;
  unreadSet: Set<string>;
  onOpen: (eventId: string) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeCardStyles(colors, type), [colors, type]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.storiesScroll}
      contentContainerStyle={styles.storiesContent}
    >
      {events.map((e) => {
        const image = metaMap[e.id]?.imageUrl;
        const ring = isLiveNow(e.starts_at, e.ends_at) || unreadSet.has(e.id);
        return (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            accessibilityLabel={e.title}
            onPress={() => onOpen(e.id)}
            style={({ pressed }) => [styles.story, pressed && styles.pressed]}
          >
            <View style={[styles.storyRing, { borderColor: ring ? colors.live : colors.line }]}>
              <View style={styles.storyCircle}>
                {image ? (
                  <FadeImage uri={image} style={styles.storyImage} />
                ) : (
                  <Text style={styles.storyInitial}>{eventInitial(e.title)}</Text>
                )}
              </View>
            </View>
            <Text style={styles.storyTitle} numberOfLines={1}>
              {e.title}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function EventCard({
  event,
  meta,
  hasUnread,
  onPress,
}: {
  event: Event;
  meta?: EventMeta;
  hasUnread?: boolean;
  onPress: () => void;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeCardStyles(colors, type), [colors, type]);
  const [countdown, setCountdown] = useState(() =>
    formatLiveCountdown(event.starts_at, event.ends_at)
  );

  useEffect(() => {
    setCountdown(formatLiveCountdown(event.starts_at, event.ends_at));
    const interval = setInterval(() => {
      setCountdown(formatLiveCountdown(event.starts_at, event.ends_at));
    }, 30000);
    return () => clearInterval(interval);
  }, [event.starts_at, event.ends_at]);

  const live = countdown === 'Happening now';
  const image = meta?.imageUrl;
  const attendees = (meta?.attendees ?? []).slice(0, 4);
  const goingCount = meta?.goingCount ?? (attendees.length > 0 ? attendees.length : 1);

  const badge = (
    <View style={[styles.badge, live ? styles.badgeLive : image ? styles.badgeOnPhoto : styles.badgePlain]}>
      <Text
        style={[
          styles.badgeText,
          live ? { color: colors.onLive } : image ? { color: '#FFFFFF' } : { color: colors.inkMuted },
        ]}
      >
        {live ? 'Live now' : countdown}
      </Text>
    </View>
  );

  return (
    <Pressable
      // Keyed by shape so switching between photo and text builds a new view.
      key={image ? 'photo' : 'text'}
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {image ? (
        <View style={styles.cardPhotoWrap}>
          <FadeImage uri={image} style={styles.cardPhoto} />
          <View style={styles.badgeSlot}>{badge}</View>
          {hasUnread && <View style={styles.cardUnreadDot} />}
        </View>
      ) : null}
      <View style={styles.cardBody}>
        {!image && (
          <View style={styles.topRow}>
            {badge}
            {hasUnread && <View style={styles.unreadDot} />}
          </View>
        )}
        <Text style={styles.cardTitle} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={styles.cardSubtitle} numberOfLines={2}>
          {formatDay(event.starts_at)} · {formatTime(event.starts_at)}
          {event.location ? ` · ${placeLabel(event.location)}` : ''}
        </Text>
        <View style={styles.avatarsRow}>
          {attendees.length > 0 && (
            <View style={styles.avatarStack}>
              {attendees.map((att, idx) => (
                <Avatar
                  key={att.userId || idx}
                  userId={att.userId}
                  name={att.name}
                  avatarUrl={att.avatarUrl}
                  size={26}
                  style={[
                    styles.avatarBorder,
                    idx > 0 && styles.avatarOverlap,
                    { zIndex: attendees.length - idx },
                  ]}
                />
              ))}
            </View>
          )}
          <Text style={styles.goingText}>{goingCount} going</Text>
        </View>
      </View>
    </Pressable>
  );
}

// Past events whose photos are about to go: a row of cards with the days
// left in coral, so people save them (or keep them) in time.
function ExpiringStrip({
  tiles,
  onOpen,
}: {
  tiles: ExpiringTile[];
  onOpen: (eventId: string) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeCardStyles(colors, type), [colors, type]);
  const size = 132;
  return (
    <View style={styles.memories}>
      <SectionLabel>Expiring soon</SectionLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.storiesScroll}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
      >
        {tiles.map((t) => (
          <Pressable
            key={t.eventId}
            accessibilityRole="button"
            accessibilityLabel={`${t.title}, photos deleted in ${t.days} ${t.days === 1 ? 'day' : 'days'}`}
            onPress={() => onOpen(t.eventId)}
            style={({ pressed }) => [{ width: size }, pressed && styles.pressed]}
          >
            <View style={[styles.memoryThumb, { width: size, height: size, overflow: 'hidden' }]}>
              <FadeImage uri={t.image} style={{ width: size, height: size }} />
            </View>
            <Text style={styles.memoryTitle} numberOfLines={1}>
              {t.title}
            </Text>
            <Text style={[type.caption, { color: colors.accentText, fontFamily: fonts.bodySemiBold }]}>
              {t.days <= 1 ? 'Deleted tomorrow' : `Deleted in ${t.days} days`}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function MemoryStrip({
  tiles,
  onOpen,
}: {
  tiles: MemoryTile[];
  onOpen: (eventId: string) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeCardStyles(colors, type), [colors, type]);
  const { width } = useWindowDimensions();
  const gap = spacing.sm;
  const size = Math.floor((width - spacing.lg * 2 - gap * 2) / 3);
  return (
    <View style={styles.memories}>
      <SectionLabel>From your memories</SectionLabel>
      <View style={styles.memoriesGrid}>
        {tiles.slice(0, 6).map((t) => (
          <Pressable
            key={t.eventId}
            accessibilityRole="button"
            accessibilityLabel={`${t.title} memories`}
            onPress={() => onOpen(t.eventId)}
            style={({ pressed }) => [{ width: size }, pressed && styles.pressed]}
          >
            {/* The frame shows the placeholder colour while the photo fades in. */}
            <View style={[styles.memoryThumb, { width: size, height: size, overflow: 'hidden' }]}>
              <FadeImage uri={t.image} style={{ width: size, height: size }} />
            </View>
            <Text style={styles.memoryTitle} numberOfLines={1}>
              {t.title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeCardStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    pressed: { transform: [{ scale: 0.98 }] },
    storiesScroll: { marginHorizontal: -spacing.lg },
    storiesContent: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    story: { width: 68, alignItems: 'center', gap: 4 },
    storyRing: {
      width: 66,
      height: 66,
      borderRadius: 33,
      borderWidth: 2.5,
      padding: 2,
    },
    storyCircle: {
      flex: 1,
      borderRadius: 31,
      overflow: 'hidden',
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    storyImage: { width: '100%', height: '100%', resizeMode: 'cover' },
    storyInitial: { fontFamily: fonts.heading, fontSize: 22, color: c.ink },
    storyTitle: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
      color: c.inkMuted,
      maxWidth: 68,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: c.line,
      overflow: 'hidden',
      marginVertical: spacing.xs,
    },
    cardPhotoWrap: { height: 160, backgroundColor: c.line },
    cardPhoto: { width: '100%', height: '100%', resizeMode: 'cover' },
    badgeSlot: { position: 'absolute', top: spacing.sm, left: spacing.sm },
    cardUnreadDot: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: c.danger,
    },
    cardBody: { padding: spacing.md, gap: 4 },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.full,
    },
    badgeLive: { backgroundColor: c.live },
    badgeOnPhoto: { backgroundColor: 'rgba(0, 0, 0, 0.55)' },
    badgePlain: { backgroundColor: c.paper },
    badgeText: { fontSize: 12, fontFamily: fonts.bodySemiBold, letterSpacing: 0.2 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.danger },
    cardTitle: {
      fontFamily: fonts.display,
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.3,
      color: c.ink,
    },
    cardSubtitle: { ...t.caption, fontSize: 14, color: c.inkMuted },
    avatarsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    avatarStack: { flexDirection: 'row', alignItems: 'center' },
    avatarOverlap: { marginLeft: -8 },
    avatarBorder: { borderWidth: 2, borderColor: c.card },
    goingText: { color: c.inkMuted, fontSize: 13, fontFamily: fonts.bodyMedium },
    memories: { marginTop: SECTION_GAP, alignSelf: 'stretch' },
    memoriesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    memoryThumb: { borderRadius: radii.card, backgroundColor: c.card },
    memoryTitle: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: c.ink,
      marginTop: 4,
    },
  });

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    topBar: {

      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    greetingText: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 13,
      marginBottom: 2,
    },
    titleRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    displayTitle: {
      flex: 1,
      flexShrink: 1,
      fontFamily: fonts.display,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.5,
      color: c.ink,
    },
    iconBtn: {
      width: 44,
      height: 44,
      flexShrink: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    bellInner: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bellBadge: {
      position: 'absolute',
      top: -3,
      right: -6,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    bellBadgeText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontFamily: fonts.bodySemiBold,
      lineHeight: 12,
    },
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      flexGrow: 1,
    },
    sectionHeaderWrap: {
      paddingTop: spacing.sm,
    },
    sectionSpacer: {
      height: SECTION_GAP - spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    cardGap: {
      height: spacing.xs,
    },
    rowDivider: {
      height: 1,
      backgroundColor: c.line,
      marginLeft: 56, // Inset past the date block
    },
    dateBlock: {
      alignItems: 'center',
      minWidth: 44,
    },
    dateDay: {
      fontFamily: fonts.heading,
      fontSize: 22,
      lineHeight: 26,
      color: c.ink,
    },
    dateMonth: {
      ...t.caption,
      fontSize: 11,
      letterSpacing: 0.8,
      color: c.inkMuted,
      fontFamily: fonts.bodySemiBold,
    },
    quieterText: {
      color: c.inkMuted,
    },
    rowContent: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      fontSize: 16,
      color: c.ink,
    },
    rowSubtitle: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 13,
    },
    rowUnreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
      marginRight: 2,
    },
    photoCard: {
      height: 180,
      width: '100%',
      borderRadius: radii.card,
      overflow: 'hidden',
      position: 'relative',
      marginVertical: spacing.xs,
      backgroundColor: c.card,
    },
    photoCardImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    photoCardContent: {
      position: 'absolute',
      bottom: spacing.md,
      left: spacing.md,
      right: spacing.md,
    },
    photoCardTitle: {
      fontFamily: fonts.headingMedium,
      fontSize: 18,
      color: '#FFFFFF',
      marginBottom: 2,
    },
    photoCountLabel: {
      fontSize: 12,
      fontFamily: fonts.bodyMedium,
      color: 'rgba(255, 255, 255, 0.85)',
    },
    cardUnreadDot: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: c.danger,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: spacing.xxl,
      gap: spacing.md,
    },
    emptyText: {
      ...t.body,
      color: c.inkMuted,
      textAlign: 'center',
    },
    emptyLink: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.accentText,
      textAlign: 'center',
    },
    emptyTitle: {
      ...t.h3,
      textAlign: 'center',
      marginBottom: -spacing.sm,
    },
    staleNote: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    staleText: {
      ...t.caption,
      flex: 1,
    },
    staleAction: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    emptyButton: {
      minWidth: 160,
      height: 44,
      paddingHorizontal: spacing.xl,
    },
    skeletonContainer: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.lg,
    },
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    skeletonDate: {
      width: 44,
      height: 44,
      borderRadius: radii.control,
      backgroundColor: c.card,
    },
    skeletonContent: {
      flex: 1,
      gap: 6,
    },
    skeletonTitle: {
      width: '55%',
      height: 16,
      borderRadius: radii.tag,
      backgroundColor: c.card,
    },
    skeletonSubtitle: {
      width: '35%',
      height: 12,
      borderRadius: radii.tag,
      backgroundColor: c.card,
    },
  });
