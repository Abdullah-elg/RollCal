// The event page: details, RSVP, attendees, bills, the roll (EventAlbum),
// activity, and the invite and QR pass sheet. The host edits, deletes,
// reopens the roll, removes people and chooses the cover from here.

import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import ConfirmDialog from '../components/ConfirmDialog';
import EventAlbum, { LoadedPhoto } from '../components/EventAlbum';
import EventQrPanel from '../components/EventQrPanel';
import {
  ArrowIcon,
  ChatIcon,
  ChevronRightIcon,
  EditIcon,
  MapPinIcon,
  PlusIcon,
} from '../components/icons';
import InviteFriendsPanel from '../components/InviteFriendsPanel';
import JoinModePicker from '../components/JoinModePicker';
import NavAppSheet from '../components/NavAppSheet';
import PersonActionsSheet, { ActionsPerson } from '../components/PersonActionsSheet';
import { MoreAction } from '../components/PersonRow';
import ReportSheet from '../components/ReportSheet';
import RsvpSelector from '../components/RsvpSelector';
import { Button, ThemedSwitch } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { animateNext } from '../lib/animate';
import { BillSummary, listEventBills } from '../lib/bills';
import { formatCents } from '../lib/money';
import { formatSpan } from '../lib/dates';
import { hapticLight, hapticMedium } from '../lib/haptics';
import { syncEventReminders } from '../lib/notifications';
import { loadEventActivity } from '../lib/activity';
import {
  EventInvitation,
  loadEventInvitations,
  removeInvitation,
} from '../lib/invitations';
import { pickAndUploadCover, setCoverPhoto } from '../lib/coverPhoto';
import { removeEventFiles } from '../lib/photos';
import { reopenRoll, rollState } from '../lib/roll';
import {
  answerJoinRequest,
  JoinMode,
  JoinRequest,
  loadJoinRequests,
  setJoinMode,
} from '../lib/joinRequests';
import { setRsvp } from '../lib/rsvp';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Event, RsvpStatus } from '../types';

type Props = NativeStackScreenProps<AppStackParamList, 'EventDetail'>;

type Attendee = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  status: RsvpStatus | 'host';
};

const STATUS_LABEL: Record<Attendee['status'], string> = {
  host: 'Host',
  going: 'Going',
  maybe: 'Maybe',
  not_going: "Can't go",
};


function SlideInAvatar({
  name,
  userId,
  avatarUrl,
  size,
  shouldSlideIn,
  style,
}: {
  name: string;
  userId: string;
  avatarUrl?: string | null;
  size: number;
  shouldSlideIn?: boolean;
  style: StyleProp<ViewStyle>;
}) {
  const anim = useRef(new Animated.Value(shouldSlideIn ? 0 : 1)).current;

  useEffect(() => {
    if (shouldSlideIn) {
      anim.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        friction: 8,
        tension: 100,
        useNativeDriver: true,
      }).start();
    }
  }, [shouldSlideIn, anim]);

  if (!shouldSlideIn) {
    return (
      <View style={style}>
        <Avatar name={name} userId={userId} avatarUrl={avatarUrl} size={size} />
      </View>
    );
  }

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-24, 0],
  });

  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [{ translateX }, { scale }],
          opacity,
        },
      ]}
    >
      <Avatar name={name} userId={userId} avatarUrl={avatarUrl} size={size} />
    </Animated.View>
  );
}

function billStatusLabel(b: BillSummary): string {
  if (b.bill.status === 'draft') return 'Draft';
  const left = b.totalCents - b.paidCents;
  if (b.bill.status === 'settled' || left <= 0) return 'Paid up';
  return `${formatCents(left, b.bill.currency)} left`;
}

export default function EventDetailScreen({ navigation, route }: Props) {
  const { eventId } = route.params;
  const { session } = useAuth();
  const { colors, type } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const { unreadChats, markPhotosRead } = useUnread();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [myStatus, setMyStatus] = useState<RsvpStatus | null>(null);
  const [justRsvpdGoing, setJustRsvpdGoing] = useState(false);
  const [activityLine, setActivityLine] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRsvp, setSavingRsvp] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'leave' | 'cancel' | null>(null);
  const [showNavApps, setShowNavApps] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<Attendee | null>(null);
  const [actingOn, setActingOn] = useState<ActionsPerson | null>(null);
  const [reportingEvent, setReportingEvent] = useState(false);
  const [bills, setBills] = useState<BillSummary[]>([]);
  // Only loaded for the host, on events that need approval.
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [answeringRequest, setAnsweringRequest] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<EventInvitation[]>([]);
  const [albumPhotos, setAlbumPhotos] = useState<LoadedPhoto[]>([]);
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(null);
  const [uploadsClosed, setUploadsClosed] = useState(false);
  const [latestMessage, setLatestMessage] = useState<{
    body: string;
    senderName: string;
  } | null>(null);

  // The sheet has three pages: the event's details, inviting friends, and the event QR pass.
  const [infoPage, setInfoPage] = useState<'info' | 'invite' | 'share'>('info');
  const [refreshSeq, setRefreshSeq] = useState(0);
  const hasLoadedRef = useRef(false);
  const screenAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(screenAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [screenAnim]);

  const load = useCallback(async () => {
    const { data: ev } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();

    if (!ev) {
      setEvent(null);
      setLoaded(true);
      return;
    }

    const [
      { data: rsvps },
      eventInvites,
      { data: latestMsg },
      activity,
      eventBills,
    ] = await Promise.all([
      supabase.from('rsvps').select('user_id, status, created_at').eq('event_id', eventId),
      loadEventInvitations(eventId),
      supabase
        .from('messages')
        .select('id, body, sender_id, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadEventActivity(eventId, session?.user.id ?? ''),
      listEventBills(eventId),
    ]);
    setJoinRequests(
      ev.creator_id === session?.user.id ? await loadJoinRequests(eventId) : []
    );

    const ids = [
      ev.creator_id,
      ...(rsvps ?? []).map((r) => r.user_id),
      ...(latestMsg ? [latestMsg.sender_id] : []),
    ];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', ids);

    const nameOf = (id: string) =>
      profiles?.find((p) => p.id === id)?.display_name ?? 'Someone';
    const avatarOf = (id: string) =>
      profiles?.find((p) => p.id === id)?.avatar_url ?? null;

    const order: Record<RsvpStatus, number> = { going: 0, maybe: 1, not_going: 2 };
    const list: Attendee[] = [
      {
        userId: ev.creator_id,
        name: nameOf(ev.creator_id),
        avatarUrl: avatarOf(ev.creator_id),
        status: 'host',
      },
      ...(rsvps ?? [])
        .filter((r) => r.user_id !== ev.creator_id)
        .sort((a, b) => order[a.status as RsvpStatus] - order[b.status as RsvpStatus])
        .map((r) => ({
          userId: r.user_id,
          name: nameOf(r.user_id),
          avatarUrl: avatarOf(r.user_id),
          status: r.status as RsvpStatus,
        })),
    ];

    if (latestMsg) {
      setLatestMessage({
        body: latestMsg.body,
        senderName: nameOf(latestMsg.sender_id),
      });
    } else {
      setLatestMessage(null);
    }

    animateNext(hasLoadedRef.current);
    setEvent(ev);
    setActivityLine(activity);
    setUploadsClosed(ev.uploads_closed);
    setCoverPhotoId(ev.cover_photo_id ?? null);
    setAttendees(list);
    setInvitations(eventInvites);
    setBills(eventBills);
    setMyStatus(
      ((rsvps ?? []).find((r) => r.user_id === session?.user.id)?.status as RsvpStatus) ??
        null
    );
    setLoaded(true);
    hasLoadedRef.current = true;
    setRefreshSeq((n) => n + 1);

    if (session?.user.id) {
      markPhotosRead(eventId, new Date().toISOString());
    }
  }, [eventId, session?.user.id]);

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

  // The host lets someone in (they become a guest) or turns them down.
  const answerRequest = async (requestId: string, approve: boolean) => {
    hapticLight();
    setAnsweringRequest(requestId);
    const error = await answerJoinRequest(requestId, approve);
    setAnsweringRequest(null);
    if (error) {
      Alert.alert(approve ? 'Could not approve' : 'Could not decline', error);
      return;
    }
    setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    if (approve) load();
  };

  const changeJoinMode = async (mode: JoinMode) => {
    if (!event || event.join_mode === mode) return;
    hapticLight();
    const before = event;
    setEvent({ ...event, join_mode: mode, is_link_enabled: mode !== 'invite' });
    const error = await setJoinMode(event.id, mode);
    if (error) {
      setEvent(before);
      Alert.alert('Could not change who can join', error);
      return;
    }
    // Requests only show for approval events; load them when switching to it.
    if (mode === 'approval') setJoinRequests(await loadJoinRequests(event.id));
  };

  const openInfo = () => {
    setInfoPage('info');
    setShowInfo(true);
    load();
  };

  const coverPhoto = useMemo(() => {
    if (!coverPhotoId) return null;
    const match = albumPhotos.find((p) => p.id === coverPhotoId);
    return match?.url ?? null;
  }, [coverPhotoId, albumPhotos]);

  const handleSetCoverPhoto = async (photoId: string | null) => {
    if (!event) return;
    hapticLight();
    setCoverPhotoId(photoId);
    setEvent((prev) => (prev ? { ...prev, cover_photo_id: photoId } : prev));
    const { error } = await setCoverPhoto(event.id, photoId);
    if (error) Alert.alert('Could not update the event photo', error);
  };

  const [uploadingCover, setUploadingCover] = useState(false);
  const uploadCover = async () => {
    if (!event || !session?.user.id) return;
    setUploadingCover(true);
    const { photoId, error } = await pickAndUploadCover(event.id, session.user.id);
    setUploadingCover(false);
    if (error) {
      Alert.alert('Upload failed', error);
    } else if (photoId) {
      hapticLight();
      // Reload so the album fetches the new photo and the header shows it.
      load();
    }
  };

  if (!loaded || !event) {
    return (
      <View style={[styles.screen, styles.center]}>
        {!loaded ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <Text style={type.h2}>Event not found</Text>
            <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>
              It may have been deleted, or you no longer have access.
            </Text>
          </>
        )}
      </View>
    );
  }

  const isLeader = event.creator_id === session?.user.id;
  const hostName = attendees.find((a) => a.status === 'host')?.name;
  // The host can remove anyone but themselves, from the person's ··· menu.
  const removableActingOn = isLeader
    ? attendees.find((a) => a.userId === actingOn?.id && a.status !== 'host') ?? null
    : null;
  const goingAttendees = attendees.filter(
    (a) => a.status === 'going' || a.status === 'host'
  );
  const goingCount = goingAttendees.length;

  const isMember =
    isLeader ||
    myStatus !== null ||
    invitations.some(
      (row) =>
        row.profile.id === session?.user.id && row.invitation.status === 'accepted'
    );

  const waitingInvites = invitations.filter(
    (row) =>
      row.invitation.status === 'pending' &&
      !attendees.some((a) => a.userId === row.profile.id)
  );

  const {
    beforeEnd,
    withinWindow: withinUploadWindow,
    uploadOpen,
    msLeft,
  } = rollState(event, uploadsClosed);
  const under3Hours = uploadOpen && msLeft > 0 && msLeft <= 3 * 60 * 60 * 1000;
  const hoursLeft = Math.max(1, Math.round(msLeft / (60 * 60 * 1000)));
  const minutesLeft = Math.max(1, Math.round(msLeft / (60 * 1000)));
  const timeLeftCopy = hoursLeft <= 1 ? `${minutesLeft} minutes` : `${hoursLeft} hours`;

  const toggleUploads = async () => {
    hapticLight();
    const next = !uploadsClosed;
    setUploadsClosed(next);
    const { error } = await supabase
      .from('events')
      .update({ uploads_closed: next })
      .eq('id', event.id);
    if (error) {
      setUploadsClosed(!next);
      Alert.alert('Could not update', error.message);
    }
  };

  const reopen = async () => {
    hapticLight();
    const { until, error } = await reopenRoll(event.id);
    if (error) {
      Alert.alert('Could not reopen the roll', error);
      return;
    }
    setUploadsClosed(false);
    setEvent((prev) =>
      prev ? { ...prev, uploads_closed: false, uploads_reopened_until: until } : prev
    );
    // Move the "roll closing" reminders to the new close time.
    syncEventReminders();
  };

  const chooseRsvp = async (status: RsvpStatus) => {
    if (!session) return;
    if (status === 'going') {
      hapticMedium();
      setJustRsvpdGoing(true);
      setTimeout(() => setJustRsvpdGoing(false), 2000);
    } else {
      hapticLight();
    }
    const prevStatus = myStatus;
    const prevAttendees = attendees;

    // Optimistic update
    setMyStatus(status);
    setAttendees((prev) => {
      const exists = prev.some((a) => a.userId === session.user.id);
      if (!exists) {
        return [...prev, { userId: session.user.id, name: 'You', status }];
      }
      return prev.map((a) => (a.userId === session.user.id ? { ...a, status } : a));
    });

    setSavingRsvp(true);
    const err = await setRsvp(event.id, session.user.id, status);
    setSavingRsvp(false);
    if (err) {
      setMyStatus(prevStatus);
      setAttendees(prevAttendees);
      Alert.alert('Could not update RSVP', err);
    } else {
      syncEventReminders();
      load();
    }
  };

  const leaveEvent = async () => {
    setConfirmAction(null);
    const { error } = await supabase
      .from('rsvps')
      .delete()
      .eq('event_id', event.id)
      .eq('user_id', session!.user.id);
    if (error) {
      Alert.alert('Could not leave', error.message);
      return;
    }
    syncEventReminders();
    setShowInfo(false);
    navigation.goBack();
  };

  const removeMember = async (ban: boolean) => {
    const target = memberToRemove;
    setMemberToRemove(null);
    if (!target) return;
    if (ban) {
      const { error } = await supabase
        .from('event_bans')
        .upsert(
          { event_id: event!.id, user_id: target.userId },
          { onConflict: 'event_id,user_id', ignoreDuplicates: true }
        );
      if (error) {
        Alert.alert('Could not remove', error.message);
        return;
      }
    }
    await supabase
      .from('rsvps')
      .delete()
      .eq('event_id', event!.id)
      .eq('user_id', target.userId);
    await supabase
      .from('invitations')
      .delete()
      .eq('event_id', event!.id)
      .eq('invited_user_id', target.userId);
    load();
  };

  const cancelEvent = async () => {
    setConfirmAction(null);
    await removeEventFiles(event.id);
    const { error } = await supabase.from('events').delete().eq('id', event.id);
    if (error) {
      Alert.alert('Could not cancel', error.message);
      return;
    }
    syncEventReminders();
    setShowInfo(false);
    navigation.goBack();
  };

  const withdrawInvite = async (invitationId: string) => {
    const err = await removeInvitation(invitationId);
    if (err) {
      Alert.alert('Could not withdraw', err);
      return;
    }
    load();
  };

  return (
    <View style={styles.screen}>
      <Animated.View
        style={{
          flex: 1,
          opacity: screenAnim,
          transform: [
            {
              translateY: screenAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        }}
      >
        <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        }
      >
        {coverPhoto && (
          <View style={[styles.coverContainer, { width: screenWidth }]}>
            <Image
              source={{ uri: coverPhoto }}
              style={styles.coverImage}
              resizeMode="cover"
            />
          </View>
        )}

        <View style={styles.bodyWrap}>
          <View style={styles.titleRow}>
            <Text
              style={coverPhoto ? styles.titleWithCover : styles.bigDisplayTitle}
            >
              {event.title}
            </Text>
            {isLeader && (
              <Pressable
                style={styles.editButton}
                onPress={() =>
                  navigation.navigate('CreateEvent', { editEventId: event.id })
                }
                hitSlop={12}
              >
                <EditIcon size={19} color={colors.inkMuted} />
              </Pressable>
            )}
            <View style={{ flex: 1 }} />
            <Pressable style={styles.infoButton} onPress={openInfo} hitSlop={12}>
              <Text style={styles.infoGlyph}>i</Text>
            </Pressable>
          </View>

          <Text style={styles.hostLine}>
            {isLeader ? 'Hosted by you' : hostName ? `Hosted by ${hostName}` : ''}
          </Text>

          <View style={styles.metaBlock}>
            <Text style={styles.dateText}>
              {formatSpan(event.starts_at, event.ends_at)}
            </Text>
            {event.location ? (
              <Pressable
                style={({ pressed }) => [
                  styles.locationRow,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => setShowNavApps(true)}
              >
                <MapPinIcon size={15} color={colors.inkMuted} />
                <Text style={styles.locationText}>{event.location}</Text>
              </Pressable>
            ) : null}
          </View>

          {activityLine ? (
            <View style={styles.activityWrap}>
              <View style={styles.activityDot} />
              <Text style={styles.activityText}>{activityLine}</Text>
            </View>
          ) : null}

          {/* Under 3 hours left in the film roll upload window */}
          {under3Hours && (
            <View style={styles.urgentRollBanner}>
              <View style={styles.urgentRollDot} />
              <Text style={styles.urgentRollText}>
                The roll closes in {timeLeftCopy}. Add your photos before it closes.
              </Text>
            </View>
          )}

          {event.description ? (
            <Text style={[type.body, styles.descriptionText]}>{event.description}</Text>
          ) : null}

          {goingCount > 0 && (
            <>
              <View style={styles.divider} />
              <Pressable
                style={({ pressed }) => [
                  styles.whosGoingRow,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={openInfo}
              >
                <View style={styles.avatarStack}>
                  {goingAttendees.slice(0, 5).map((a, i) => {
                    const isMe = a.userId === session?.user.id;
                    return (
                      <SlideInAvatar
                        key={a.userId}
                        name={a.name}
                        userId={a.userId}
                        avatarUrl={a.avatarUrl}
                        size={28}
                        shouldSlideIn={justRsvpdGoing && isMe}
                        style={[
                          styles.avatarStackRing,
                          { marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i },
                        ]}
                      />
                    );
                  })}
                </View>
                <Text style={styles.goingCountText}>{goingCount} going</Text>
                <View style={{ flex: 1 }} />
                <ChevronRightIcon size={16} color={colors.inkMuted} />
              </Pressable>
            </>
          )}

          {isLeader && joinRequests.length > 0 && (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionHeader}>Requests to join</Text>
              {joinRequests.map((r) => (
                <View key={r.id} style={styles.requestRow}>
                  <Avatar name={r.name} userId={r.userId} avatarUrl={r.avatarUrl} size={36} />
                  <View style={styles.requestText}>
                    <Text style={type.body} numberOfLines={1}>
                      {r.name}
                    </Text>
                    {r.username ? (
                      <Text style={type.caption} numberOfLines={1}>
                        @{r.username}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => answerRequest(r.id, false)}
                    disabled={answeringRequest !== null}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Decline ${r.name}`}
                    style={({ pressed }) => [styles.requestDecline, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.withdrawText}>Decline</Text>
                  </Pressable>
                  <Button
                    title="Approve"
                    onPress={() => answerRequest(r.id, true)}
                    loading={answeringRequest === r.id}
                    disabled={answeringRequest !== null}
                    style={styles.requestApprove}
                  />
                </View>
              ))}
            </>
          )}

          {!isLeader && (
            <>
              <View style={styles.divider} />
              <View style={styles.rsvpHeaderRow}>
                <Text style={styles.sectionHeader}>Your RSVP</Text>
                {myStatus === 'going' && (
                  <View style={styles.youreInBadge}>
                    <Text style={styles.youreInText}>You're in.</Text>
                  </View>
                )}
              </View>
              <RsvpSelector
                value={myStatus}
                onSelect={chooseRsvp}
                disabled={savingRsvp}
              />
            </>
          )}

          {isMember && (
            <>
              <View style={styles.divider} />
              <Pressable
                style={({ pressed }) => [
                  styles.chatRow,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() =>
                  navigation.navigate('EventChat', {
                    eventId: event.id,
                    title: event.title,
                  })
                }
              >
                <View style={styles.chatIconWrap}>
                  <ChatIcon size={18} color={colors.inkMuted} />
                </View>
                <View style={styles.chatInfoWrap}>
                  <Text style={styles.chatTitle}>Event chat</Text>
                  <Text style={styles.chatPreview} numberOfLines={1}>
                    {latestMessage
                      ? `${latestMessage.senderName}: ${latestMessage.body}`
                      : 'No messages yet. Say hello.'}
                  </Text>
                </View>
                {unreadChats.includes(event.id) && <View style={styles.unreadDot} />}
                <ChevronRightIcon size={16} color={colors.inkMuted} />
              </Pressable>
            </>
          )}

          {isMember && (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionHeader}>Bills</Text>
              {bills.map((b) => (
                <Pressable
                  key={b.bill.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.billRow, pressed && { opacity: 0.7 }]}
                  onPress={() => navigation.navigate('Bill', { billId: b.bill.id })}
                >
                  <View style={styles.chatInfoWrap}>
                    <Text style={styles.chatTitle} numberOfLines={1}>
                      {b.bill.title || 'Bill'}
                    </Text>
                    <Text style={styles.chatPreview} numberOfLines={1}>
                      Paid by {b.creatorName} · {formatCents(b.totalCents, b.bill.currency)}
                    </Text>
                  </View>
                  <Text style={styles.chatPreview}>{billStatusLabel(b)}</Text>
                  <ChevronRightIcon size={16} color={colors.inkMuted} />
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.billRow, pressed && { opacity: 0.7 }]}
                onPress={() => navigation.navigate('BillReview', { eventId: event.id })}
              >
                <PlusIcon size={18} color={colors.ink} />
                <Text style={[styles.chatTitle, { flex: 1 }]}>Split a bill</Text>
              </Pressable>
            </>
          )}

          <View style={styles.divider} />

          <EventAlbum
            event={event}
            isLeader={isLeader}
            userId={session!.user.id}
            refreshSeq={refreshSeq}
            onPhotosChange={setAlbumPhotos}
            uploadsClosedOverride={uploadsClosed}
            onReopenRoll={reopen}
            coverPhotoId={coverPhotoId}
            onSetCoverPhoto={handleSetCoverPhoto}
          />
        </View>
      </ScrollView>
    </Animated.View>

      <NavAppSheet
        visible={showNavApps}
        location={event.location}
        lat={event.location_lat}
        lng={event.location_lng}
        onClose={() => setShowNavApps(false)}
      />

      <Modal
        visible={showInfo}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS === 'android'}
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={() => setShowInfo(false)}
      >
        <View style={Platform.OS === 'android' ? styles.sheetOverlay : { flex: 1 }}>
          <SafeAreaView
            style={[
              styles.modalScreen,
              Platform.OS === 'android' && styles.androidSheetCard,
            ]}
            edges={['bottom']}
          >
            {Platform.OS === 'android' && (
              <View style={styles.sheetHandleBar}>
                <View style={styles.sheetHandle} />
              </View>
            )}

            <View style={styles.modalHeader}>
              {infoPage === 'invite' ? (
                <Pressable
                  style={styles.modalBack}
                  onPress={() => setInfoPage('info')}
                  hitSlop={8}
                >
                  <ArrowIcon size={20} color={colors.ink} direction="left" />
                  <Text style={type.h2}>Invite friends</Text>
                </Pressable>
              ) : infoPage === 'share' ? (
                <Pressable
                  style={styles.modalBack}
                  onPress={() => setInfoPage('info')}
                  hitSlop={8}
                >
                  <ArrowIcon size={20} color={colors.ink} direction="left" />
                  <Text style={type.h2}>Share</Text>
                </Pressable>
              ) : (
                <Text style={type.h2}>Event info</Text>
              )}
              <Pressable onPress={() => setShowInfo(false)} hitSlop={8}>
                <Text style={styles.modalDone}>Done</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent}>
              {infoPage === 'invite' ? (
                <InviteFriendsPanel
                  eventId={event.id}
                  userId={session!.user.id}
                  isLeader={isLeader}
                  onChanged={load}
                />
              ) : infoPage === 'share' ? (
                <EventQrPanel event={event} />
              ) : (
                <>
                  {isLeader && withinUploadWindow && (
                    <View style={styles.sheetSection}>
                      <Text style={styles.sectionHeader}>Photo uploads</Text>
                      <View style={styles.switchRow}>
                        <View style={{ flex: 1, paddingRight: spacing.md }}>
                          <Text style={type.body}>Allow uploads</Text>
                          <Text style={type.caption}>
                            {uploadsClosed
                              ? `The roll was closed early. ${hoursLeft} hours left in the window.`
                              : `The roll is open. ${hoursLeft} hours left to add photos.`}
                          </Text>
                        </View>
                        <ThemedSwitch
                          value={!uploadsClosed}
                          onValueChange={toggleUploads}
                        />
                      </View>
                      <View style={styles.divider} />
                    </View>
                  )}

                  {isLeader && !beforeEnd && !withinUploadWindow && (
                    <View style={styles.sheetSection}>
                      <Text style={styles.sectionHeader}>Photo uploads</Text>
                      <Text style={type.caption}>
                        The roll is closed. Reopen it and everyone can add photos for the
                        next 24 hours.
                      </Text>
                      <Button
                        title="Reopen for 24 hours"
                        variant="secondary"
                        onPress={reopen}
                        style={{ marginTop: spacing.md }}
                      />
                      <View style={styles.divider} />
                    </View>
                  )}

                  {isLeader && (
                    <View style={styles.sheetSection}>
                      <Text style={styles.sectionHeader}>Event photo</Text>
                      {coverPhoto ? (
                        <View style={styles.coverPreviewWrap}>
                          <Image
                            source={{ uri: coverPhoto }}
                            style={styles.coverSheetThumb}
                          />
                          <View style={{ flex: 1, marginLeft: spacing.sm }}>
                            <Text style={type.body}>Photo selected</Text>
                            <Text style={type.caption}>
                              Shows at the top of the event and in past events
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => handleSetCoverPhoto(null)}
                            hitSlop={8}
                            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                          >
                            <Text style={styles.removeText}>Remove</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={type.caption}>
                          Shows at the top of the event. Guests only see it in the roll once
                          the roll opens.
                        </Text>
                      )}
                      <Button
                        title={coverPhoto ? 'Upload a different photo' : 'Upload a photo'}
                        variant="secondary"
                        onPress={uploadCover}
                        loading={uploadingCover}
                        style={{ marginTop: spacing.md }}
                      />
                      <View style={styles.divider} />
                    </View>
                  )}

                  <Text style={styles.sectionHeader}>Who's coming</Text>

                  <View style={{ gap: spacing.md }}>
                    {(
                      [
                        {
                          title: 'Going',
                          people: attendees.filter(
                            (a) => a.status === 'host' || a.status === 'going'
                          ),
                        },
                        {
                          title: 'Maybe',
                          people: attendees.filter((a) => a.status === 'maybe'),
                        },
                        {
                          title: "Can't go",
                          people: attendees.filter((a) => a.status === 'not_going'),
                        },
                      ] as { title: string; people: Attendee[] }[]
                    )
                      .filter((group) => group.people.length > 0)
                      .map((group) => (
                        <View key={group.title} style={styles.rsvpGroup}>
                          <Text style={styles.groupTitle}>
                            {group.title} · {group.people.length}
                          </Text>
                          {group.people.map((a) => (
                            <View key={a.userId} style={styles.personRow}>
                              <Avatar
                                name={a.name}
                                userId={a.userId}
                                avatarUrl={a.avatarUrl}
                                size={30}
                              />
                              <Text
                                style={[
                                  type.body,
                                  { flex: 1, marginLeft: spacing.sm },
                                ]}
                                numberOfLines={1}
                              >
                                {a.name}
                                {a.userId === session?.user.id ? ' (you)' : ''}
                              </Text>
                              {a.status === 'host' ? (
                                <Text
                                  style={[
                                    styles.statusTag,
                                    { color: colors.inkMuted },
                                  ]}
                                >
                                  {STATUS_LABEL.host}
                                </Text>
                              ) : null}
                              {a.userId !== session?.user.id && (
                                <MoreAction
                                  name={a.name}
                                  onPress={() => setActingOn({ id: a.userId, name: a.name })}
                                />
                              )}
                            </View>
                          ))}
                        </View>
                      ))}
                  </View>

                  {waitingInvites.length > 0 && (
                    <>
                      <View style={styles.divider} />
                      <Text style={styles.sectionHeader}>
                        Invited · waiting on {waitingInvites.length}
                      </Text>
                      {waitingInvites.map((row) => (
                        <View key={row.invitation.id} style={styles.personRow}>
                          <Avatar
                            name={row.profile.display_name}
                            userId={row.profile.id}
                            avatarUrl={row.profile.avatar_url}
                            size={30}
                          />
                          <Text
                            style={[
                              type.body,
                              { flex: 1, marginLeft: spacing.sm },
                            ]}
                            numberOfLines={1}
                          >
                            {row.profile.display_name}
                          </Text>
                          {isLeader && (
                            <Pressable
                              onPress={() => withdrawInvite(row.invitation.id)}
                              hitSlop={8}
                            >
                              <Text style={styles.withdrawText}>Withdraw</Text>
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </>
                  )}

                  {isLeader && (
                    <>
                      <View style={styles.divider} />
                      <Text style={styles.sectionHeader}>Who can join</Text>
                      <JoinModePicker
                        value={event.join_mode ?? (event.is_link_enabled ? 'open' : 'invite')}
                        onChange={changeJoinMode}
                      />
                    </>
                  )}

                  {(isMember || event.is_link_enabled) && (
                    <>
                      <View style={styles.divider} />
                      {isMember && (
                        <Button
                          title="Invite friends"
                          variant="secondary"
                          onPress={() => setInfoPage('invite')}
                        />
                      )}
                      {event.is_link_enabled && (
                        <Button
                          title="Share"
                          variant="secondary"
                          onPress={() => setInfoPage('share')}
                          style={isMember ? { marginTop: spacing.sm } : undefined}
                        />
                      )}
                    </>
                  )}

                  {!isLeader && myStatus !== null && (
                    <>
                      <View style={styles.divider} />
                      <Pressable
                        onPress={() => setConfirmAction('leave')}
                        hitSlop={8}
                      >
                        <Text style={styles.leaveText}>Leave event</Text>
                      </Pressable>
                    </>
                  )}

                  {!isLeader && (
                    <Pressable
                      onPress={() => setReportingEvent(true)}
                      hitSlop={8}
                      accessibilityRole="button"
                      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.reportEventText}>Report event</Text>
                    </Pressable>
                  )}

                  {isLeader && (
                    <>
                      <View style={styles.divider} />
                      <Pressable
                        onPress={() => setConfirmAction('cancel')}
                        hitSlop={8}
                      >
                        <Text style={styles.leaveText}>Cancel event</Text>
                      </Pressable>
                    </>
                  )}
                </>
              )}
            </ScrollView>

            <ConfirmDialog
              visible={confirmAction === 'leave'}
              title="Leave this event?"
              message="It disappears from your list and your RSVP is removed. You can rejoin with the invite code while the link is on."
              confirmLabel="Leave"
              destructive
              onConfirm={leaveEvent}
              onCancel={() => setConfirmAction(null)}
            />

            <Modal
              visible={memberToRemove !== null}
              transparent
              animationType="fade"
              onRequestClose={() => setMemberToRemove(null)}
            >
              <Pressable
                style={styles.removeOverlay}
                onPress={() => setMemberToRemove(null)}
              >
                <Pressable style={styles.removeCard} onPress={() => {}}>
                  <Text style={type.h2}>Remove {memberToRemove?.name}?</Text>
                  <Pressable
                    style={styles.removeOption}
                    onPress={() => removeMember(false)}
                  >
                    <Text style={styles.removeOptionTitle}>Remove</Text>
                    <Text style={type.caption}>
                      They can come back with the link or a new invite.
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.removeOption}
                    onPress={() => removeMember(true)}
                  >
                    <Text
                      style={[styles.removeOptionTitle, { color: colors.danger }]}
                    >
                      Remove and block from event
                    </Text>
                    <Text style={type.caption}>
                      They can't rejoin, even with the invite link.
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.removeCancel}
                    onPress={() => setMemberToRemove(null)}
                  >
                    <Text style={styles.removeCancelText}>Cancel</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>

            <PersonActionsSheet
              person={actingOn}
              extra={
                removableActingOn
                  ? {
                      label: 'Remove from event',
                      onPress: () => setMemberToRemove(removableActingOn),
                    }
                  : undefined
              }
              onClose={() => setActingOn(null)}
              onBlocked={load}
            />

            <ReportSheet
              visible={reportingEvent}
              target="event"
              targetId={event.id}
              targetUserId={event.creator_id}
              subject="this event"
              onClose={() => setReportingEvent(false)}
            />

            <ConfirmDialog
              visible={confirmAction === 'cancel'}
              title="Cancel this event?"
              message="This deletes the event for everyone, RSVPs included. It can't be undone."
              confirmLabel="Cancel event"
              cancelLabel="Keep event"
              destructive
              onConfirm={cancelEvent}
              onCancel={() => setConfirmAction(null)}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    content: {
      paddingBottom: spacing.xxl,
    },
    coverContainer: {
      height: 220,
      backgroundColor: c.card,
    },
    coverImage: {
      width: '100%',
      height: '100%',
      borderRadius: 0,
    },
    bodyWrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    bigDisplayTitle: {
      fontFamily: fonts.display,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.5,
      color: c.ink,
      flexShrink: 1,
    },
    titleWithCover: {
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 29,
      letterSpacing: -0.4,
      color: c.ink,
      flexShrink: 1,
    },
    editButton: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    infoButton: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: c.inkMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoGlyph: {
      fontFamily: fonts.headingMedium,
      fontSize: 12,
      color: c.inkMuted,
      marginTop: -1,
    },
    hostLine: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 14,
      marginTop: 2,
      marginBottom: spacing.sm,
    },
    metaBlock: {
      marginTop: 2,
      gap: 2,
    },
    dateText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 15,
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
    },
    locationText: {
      ...t.body,
      color: c.inkMuted,
      fontSize: 14,
    },
    activityWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      marginTop: spacing.xs,
    },
    activityDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.accent,
    },
    activityText: {
      ...t.caption,
      fontSize: 13,
      color: c.inkMuted,
      fontFamily: fonts.bodyMedium,
    },
    urgentRollBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: radii.md,
      backgroundColor: c.accent + '15',
      borderWidth: 1,
      borderColor: c.accent + '35',
      marginTop: spacing.sm,
    },
    urgentRollDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: c.accent,
    },
    urgentRollText: {
      flex: 1,
      fontSize: 13,
      fontFamily: fonts.bodySemiBold,
      color: c.accentText,
    },
    descriptionText: {
      marginTop: spacing.md,
      color: c.ink,
    },
    whosGoingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    avatarStack: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatarStackRing: {
      borderWidth: 2,
      borderColor: c.paper,
      borderRadius: 16,
    },
    goingCountText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 15,
      marginLeft: spacing.sm,
    },
    requestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    requestText: { flex: 1, minWidth: 0 },
    requestDecline: { paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
    requestApprove: { height: 36, paddingHorizontal: spacing.md },
    sectionHeader: {
      fontSize: 15,
      fontFamily: fonts.body,
      color: c.inkMuted,
      marginBottom: spacing.sm,
    },
    rsvpHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    youreInBadge: {
      backgroundColor: c.accent + '15',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.sm,
    },
    youreInText: {
      color: c.accentText,
      fontSize: 12,
      fontFamily: fonts.bodySemiBold,
    },
    chatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    billRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    chatIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatInfoWrap: {
      flex: 1,
    },
    chatTitle: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 15,
    },
    chatPreview: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 13,
      marginTop: 1,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
    },
    divider: {
      height: 1,
      backgroundColor: c.line,
      marginVertical: spacing.md,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    sheetSection: {
      marginBottom: spacing.xs,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    inviteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    inviteCode: {
      fontFamily: fonts.heading,
      fontSize: 28,
      color: c.ink,
      letterSpacing: 4,
    },
    shareButton: {
      height: 40,
      paddingHorizontal: spacing.lg,
    },
    rsvpGroup: {
      marginTop: spacing.xs,
    },
    groupTitle: {
      fontSize: 13,
      fontFamily: fonts.bodySemiBold,
      color: c.inkMuted,
      marginBottom: spacing.xs,
    },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    statusTag: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
    },
    removeText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.danger,
    },
    withdrawText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.inkMuted,
    },
    removeOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    removeCard: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      padding: spacing.lg,
    },
    removeOption: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.sm,
      backgroundColor: c.card,
      gap: 2,
    },
    removeOptionTitle: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
    },
    removeCancel: {
      marginTop: spacing.md,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    removeCancelText: {
      ...t.button,
      color: c.ink,
    },
    reportEventText: {
      ...t.body,
      color: c.inkMuted,
      textAlign: 'center',
      paddingVertical: spacing.md,
    },
    leaveText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.danger,
      textAlign: 'center',
      paddingVertical: spacing.sm,
    },
    modalScreen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    sheetOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
    },
    androidSheetCard: {
      marginTop: (RNStatusBar.currentHeight ?? 24) + 12,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      overflow: 'hidden',
    },
    sheetHandleBar: {
      alignItems: 'center',
      paddingTop: spacing.sm,
      paddingBottom: 2,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.line,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: Platform.OS === 'android' ? spacing.xs : spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    modalBack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    modalDone: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    modalContent: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    coverPreviewWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    coverSheetThumb: {
      width: 44,
      height: 44,
      borderRadius: radii.sm,
      backgroundColor: c.card,
    },
  });
