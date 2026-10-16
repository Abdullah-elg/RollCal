import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
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
import { Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { animateNext } from '../lib/animate';
import { hapticLight } from '../lib/haptics';
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

type Props = TabScreenProps<'HomeTab'>;

type EventMeta = {
  photoCount: number;
  coverUrl?: string;
  goingCount: number;
  attendees: Array<{ userId: string; name: string; avatarUrl?: string | null }>;
};

type EventSection = {
  title: string;
  type: 'upcoming' | 'past';
  data: Event[];
};

export default function HomeScreen({ navigation }: Props) {
  const { profile, session } = useAuth();
  const userId = session!.user.id;
  const { colors, type } = useTheme();
  const { unreadChats, unreadPhotos, refresh: refreshUnread } = useUnread();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  const [events, setEvents] = useState<Event[]>([]);
  const [invites, setInvites] = useState<PendingInvitation[]>([]);
  const [metaMap, setMetaMap] = useState<Record<string, EventMeta>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    const [{ data, error }, pending] = await Promise.all([
      supabase.from('events').select('*').order('starts_at', { ascending: true }),
      loadPendingInvitations(userId),
    ]);

    setInvites(pending);
    notifyEventInvitations(userId, pending);

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
            .select('id, event_id, storage_path, created_at')
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

        let signedUrlMap = new Map<string, string>();
        if (chosenCoverPaths.length > 0) {
          const { data: signed } = await supabase.storage
            .from('event-photos')
            .createSignedUrls(chosenCoverPaths, 3600);
          signed?.forEach((s) => {
            if (s.signedUrl && s.path) signedUrlMap.set(s.path, s.signedUrl);
          });
        }

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
            goingCount: going,
            attendees: attendeeList,
          };
        });

        setMetaMap(newMeta);
      }
    }

    animateNext(hasLoadedRef.current);
    setLoaded(true);
    hasLoadedRef.current = true;
    refreshUnread();
  }, [userId, refreshUnread]);

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

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const weekAgo = now - sevenDaysMs;
  const weekAhead = now + sevenDaysMs;
  const invitedIds = useMemo(() => new Set(invites.map((i) => i.event.id)), [invites]);
  const unreadSet = useMemo(
    () => new Set([...unreadChats, ...unreadPhotos]),
    [unreadChats, unreadPhotos]
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
        .sort((a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime()),
    [visible, now]
  );

  // Hero event: earliest upcoming event in the next 7 days
  const heroEvent = useMemo(() => {
    if (upcomingAll.length === 0) return null;
    const earliest = upcomingAll[0];
    const startMs = new Date(earliest.starts_at).getTime();
    if (startMs <= weekAhead) {
      return earliest;
    }
    return null;
  }, [upcomingAll, weekAhead]);

  const upcomingRemaining = useMemo(() => {
    if (!heroEvent) return upcomingAll;
    return upcomingAll.filter((e) => e.id !== heroEvent.id);
  }, [upcomingAll, heroEvent]);

  const sections = useMemo<EventSection[]>(() => {
    const list: EventSection[] = [];

    if (upcomingRemaining.length > 0) {
      list.push({
        title: 'Coming up',
        type: 'upcoming',
        data: upcomingRemaining,
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
  }, [upcomingRemaining, past]);

  const isPhotoCard = (event: Event | undefined, section: EventSection) => {
    const meta = event && metaMap[event.id];
    return section.type === 'past' && !!meta && meta.photoCount > 0 && !!meta.coverUrl;
  };

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
    // Past events with a chosen cover get a wide photo card.
    if (meta?.coverUrl && isPhotoCard(event, section)) {
      return (
        <Pressable
          style={({ pressed }) => [
            styles.photoCard,
            pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
          ]}
          onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
        >
          <Image source={{ uri: meta.coverUrl }} style={styles.photoCardImage} />
          <Svg height={90} width="100%" style={styles.cardGradient}>
            <Defs>
              <SvgLinearGradient id={`grad-${event.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000000" stopOpacity="0.75" />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height={90} fill={`url(#grad-${event.id})`} />
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
            style={[styles.rowTitle, isPast && styles.quieterText]}
            numberOfLines={1}
          >
            {event.title}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {formatTime(event.starts_at)} · {meta?.goingCount ?? 1} going
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
          <Text style={styles.displayTitle}>Your events</Text>
          <Pressable
            accessibilityLabel="Event invitations"
            accessibilityRole="button"
            onPress={() => navigation.navigate('EventInvitations')}
            hitSlop={12}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] },
            ]}
          >
            <View>
              <BellIcon size={22} color={colors.ink} />
              {invites.length > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {invites.length > 9 ? '9+' : invites.length}
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
            heroEvent ? (
              <View
                style={[
                  styles.heroWrapper,
                  sections.length > 0 && styles.heroWrapperWithSections,
                ]}
              >
                <NextUpHero
                  event={heroEvent}
                  meta={metaMap[heroEvent.id]}
                  hasUnread={unreadSet.has(heroEvent.id)}
                  onPress={() =>
                    navigation.navigate('EventDetail', { eventId: heroEvent.id })
                  }
                />
              </View>
            ) : null
          }
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeaderWrap}>
              <Text style={styles.sectionHeaderTitle}>{title}</Text>
            </View>
          )}
          ItemSeparatorComponent={({ leadingItem, trailingItem, section }) =>
            // Photo cards carry their own edges, so no hairline next to them.
            isPhotoCard(leadingItem, section) || isPhotoCard(trailingItem, section) ? (
              <View style={styles.cardGap} />
            ) : (
              <View style={styles.rowDivider} />
            )
          }
          SectionSeparatorComponent={() => <View style={styles.sectionSpacer} />}
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
          ListEmptyComponent={
            !heroEvent ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No events yet.</Text>
                <Button
                  title="Plan something"
                  onPress={() => navigation.navigate('CreateEvent')}
                  style={styles.emptyButton}
                />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function NextUpHero({
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
  const { colors, mode } = useTheme();
  const styles = useMemo(() => makeHeroStyles(colors, mode), [colors, mode]);
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

  const hasCover = Boolean(meta?.coverUrl);
  const isHappeningNow = countdown === 'Happening now';
  const attendees = meta?.attendees ?? [];
  const displayAttendees = attendees.slice(0, 4);
  const goingCount = meta?.goingCount ?? (attendees.length > 0 ? attendees.length : 1);

  if (hasCover && meta?.coverUrl) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Next up: ${event.title}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.photoCard,
          pressed && { opacity: 0.92, transform: [{ scale: 0.98 }] },
        ]}
      >
        <Image source={{ uri: meta.coverUrl }} style={styles.photoCardImage} />

        <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgLinearGradient id={`hero-grad-${event.id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity="0.45" />
              <Stop offset="0.35" stopColor="#000000" stopOpacity="0.1" />
              <Stop offset="0.6" stopColor="#000000" stopOpacity="0.35" />
              <Stop offset="1" stopColor="#000000" stopOpacity="0.85" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#hero-grad-${event.id})`} />
        </Svg>

        <View style={styles.photoOverlayContent}>
          <View style={styles.topRow}>
            <View style={[styles.badge, styles.photoBadge]}>
              <View
                style={[
                  styles.badgeDot,
                  isHappeningNow ? styles.badgeDotLive : styles.photoBadgeDot,
                ]}
              />
              <Text style={styles.photoBadgeText}>{countdown}</Text>
            </View>
            {hasUnread && <View style={styles.unreadDot} />}
          </View>

          <View style={styles.bottomArea}>
            <Text style={styles.photoTitle} numberOfLines={2}>
              {event.title}
            </Text>

            <View style={styles.avatarsRow}>
              {displayAttendees.length > 0 && (
                <View style={styles.avatarStack}>
                  {displayAttendees.map((att, idx) => (
                    <Avatar
                      key={att.userId || idx}
                      userId={att.userId}
                      name={att.name}
                      avatarUrl={att.avatarUrl}
                      size={26}
                      style={[
                        styles.avatarBorderPhoto,
                        idx > 0 && styles.avatarOverlap,
                        { zIndex: displayAttendees.length - idx },
                      ]}
                    />
                  ))}
                </View>
              )}
              <Text style={styles.photoGoingText}>{goingCount} going</Text>
            </View>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Next up: ${event.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textCard,
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.topRow}>
        <View
          style={[
            styles.badge,
            styles.cardBadge,
            isHappeningNow && styles.cardBadgeLive,
          ]}
        >
          <View
            style={[
              styles.badgeDot,
              isHappeningNow ? styles.badgeDotLive : styles.cardBadgeDot,
            ]}
          />
          <Text
            style={[
              styles.cardBadgeText,
              isHappeningNow && styles.cardBadgeTextLive,
            ]}
          >
            {countdown}
          </Text>
        </View>
        {hasUnread && <View style={styles.unreadDot} />}
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {event.title}
      </Text>

      <Text style={styles.cardSubtitle} numberOfLines={1}>
        {formatDay(event.starts_at)} · {formatTime(event.starts_at)}
        {event.location ? ` · ${event.location}` : ''}
      </Text>

      <View style={styles.avatarsRow}>
        {displayAttendees.length > 0 && (
          <View style={styles.avatarStack}>
            {displayAttendees.map((att, idx) => (
              <Avatar
                key={att.userId || idx}
                userId={att.userId}
                name={att.name}
                avatarUrl={att.avatarUrl}
                size={26}
                style={[
                  styles.avatarBorderCard,
                  idx > 0 && styles.avatarOverlap,
                  { zIndex: displayAttendees.length - idx },
                ]}
              />
            ))}
          </View>
        )}
        <Text style={styles.cardGoingText}>{goingCount} going</Text>
      </View>
    </Pressable>
  );
}

const makeHeroStyles = (c: Palette, mode: 'light' | 'dark') =>
  StyleSheet.create({
    photoCard: {
      height: 230,
      width: '100%',
      borderRadius: radii.lg,
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: c.card,
    },
    photoCardImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    photoOverlayContent: {
      ...StyleSheet.absoluteFill,
      padding: spacing.lg,
      justifyContent: 'space-between',
    },
    textCard: {
      width: '100%',
      backgroundColor: c.card,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.lg,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.full,
      gap: 6,
    },
    photoBadge: {
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    photoBadgeText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontFamily: fonts.bodySemiBold,
      letterSpacing: 0.2,
    },
    cardBadge: {
      backgroundColor: c.paper,
    },
    cardBadgeLive: {
      backgroundColor: c.accent + '1A',
    },
    cardBadgeText: {
      color: c.inkMuted,
      fontSize: 12,
      fontFamily: fonts.bodySemiBold,
      letterSpacing: 0.2,
    },
    cardBadgeTextLive: {
      color: c.accent,
    },
    badgeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    photoBadgeDot: {
      backgroundColor: 'rgba(255, 255, 255, 0.75)',
    },
    cardBadgeDot: {
      backgroundColor: c.inkMuted,
    },
    badgeDotLive: {
      backgroundColor: c.accent,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
    },
    bottomArea: {
      gap: 10,
    },
    photoTitle: {
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 29,
      letterSpacing: -0.4,
      color: '#FFFFFF',
    },
    cardTitle: {
      fontFamily: fonts.display,
      fontSize: 26,
      lineHeight: 32,
      letterSpacing: -0.4,
      color: c.ink,
      marginTop: spacing.md,
      marginBottom: 4,
    },
    cardSubtitle: {
      fontSize: 14,
      fontFamily: fonts.body,
      color: c.inkMuted,
      marginBottom: spacing.md,
    },
    avatarsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    avatarStack: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatarOverlap: {
      marginLeft: -8,
    },
    avatarBorderPhoto: {
      borderWidth: 2,
      borderColor: '#111513',
    },
    avatarBorderCard: {
      borderWidth: 2,
      borderColor: c.card,
    },
    photoGoingText: {
      color: 'rgba(255, 255, 255, 0.9)',
      fontSize: 13,
      fontFamily: fonts.bodyMedium,
    },
    cardGoingText: {
      color: c.inkMuted,
      fontSize: 13,
      fontFamily: fonts.bodyMedium,
    },
  });

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    heroWrapper: {
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs,
    },
    heroWrapperWithSections: {
      marginBottom: spacing.md,
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
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    displayTitle: {
      fontFamily: fonts.display,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.5,
      color: c.ink,
    },
    iconBtn: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'flex-end',
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
      paddingBottom: spacing.xs,
    },
    sectionHeaderTitle: {
      fontSize: 15,
      fontFamily: fonts.body,
      color: c.inkMuted,
    },
    sectionSpacer: {
      height: spacing.sm,
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
      borderRadius: radii.md,
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
    cardGradient: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
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
      borderRadius: radii.sm,
      backgroundColor: c.card,
    },
    skeletonContent: {
      flex: 1,
      gap: 6,
    },
    skeletonTitle: {
      width: '55%',
      height: 16,
      borderRadius: 4,
      backgroundColor: c.card,
    },
    skeletonSubtitle: {
      width: '35%',
      height: 12,
      borderRadius: 4,
      backgroundColor: c.card,
    },
  });
