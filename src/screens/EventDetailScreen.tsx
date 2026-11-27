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
  Modal,
  PixelRatio,
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
import EventAlbum, { filmColors, LoadedPhoto } from '../components/EventAlbum';
import EventQrPanel from '../components/EventQrPanel';
import {
  ArrowIcon,
  ChatIcon,
  ChevronRightIcon,
  EditIcon,
  MapPinIcon,
  PlusIcon,
  ShareIcon,
} from '../components/icons';
import InviteFriendsPanel from '../components/InviteFriendsPanel';
import { loadAllowed, setAllowed as saveAllowed } from '../lib/postPermissions';
import { Allowed, PostKind, ruleOf } from '../lib/postRules';
import NavAppSheet from '../components/NavAppSheet';
import PersonActionsSheet, { ActionsPerson } from '../components/PersonActionsSheet';
import { MoreAction } from '../components/PersonRow';
import ReportSheet from '../components/ReportSheet';
import RsvpSelector from '../components/RsvpSelector';
import { Button, SECTION_GAP, SectionLabel, ThemedSwitch } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useProPrompt } from '../context/ProPromptContext';
import { EventLimits, loadEventLimits, peopleMeter } from '../lib/planLimits';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { animateNext } from '../lib/animate';
import { BillSummary, listEventBills } from '../lib/bills';
import { formatCents } from '../lib/money';
import { formatDay, formatSpan, formatTime } from '../lib/dates';
import { hapticLight, hapticMedium, hapticSuccess } from '../lib/haptics';
import { syncEventReminders } from '../lib/notifications';
import { loadEventActivity } from '../lib/activity';
import {
  EventInvitation,
  loadEventInvitations,
  removeInvitation,
} from '../lib/invitations';
import { setCoverPhoto } from '../lib/coverPhoto';
import { COVER_ASPECT, parseCoverCrop } from '../lib/coverCrop';
import CoverImage from '../components/CoverImage';
import { reopenRoll, rollState } from '../lib/roll';
import {
  answerJoinRequest,
  JoinRequest,
  loadJoinRequests,
} from '../lib/joinRequests';
import { setRsvp } from '../lib/rsvp';
import { eventEnded, rsvpLabel } from '../lib/rsvpLabels';
import { guestName } from '../lib/guests';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens, TITLE_MAX_SCALE } from '../theme';
import { Event, RsvpStatus } from '../types';
import { placeLabel } from '../lib/place';

type Props = NativeStackScreenProps<AppStackParamList, 'EventDetail'>;

type Attendee = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  status: RsvpStatus | 'host';
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
  const { colors, type, mode } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const { unreadChats, markPhotosRead, markEventSeen } = useUnread();
  const styles = useMemo(() => makeStyles(colors, type, mode === 'dark'), [colors, type, mode]);

  const [event, setEvent] = useState<Event | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  // The event's plan limits (people, photos); null when not loaded.
  const [limits, setLimits] = useState<EventLimits | null>(null);
  const { showProPrompt } = useProPrompt();
  const [myStatus, setMyStatus] = useState<RsvpStatus | null>(null);
  const [justRsvpdGoing, setJustRsvpdGoing] = useState(false);
  const [activityLine, setActivityLine] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The first load couldn't reach the server (no signal, or it timed out).
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRsvp, setSavingRsvp] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  // True once event_plan says the album is already kept forever. Any error
  // (the function may not exist yet) leaves it false, so the row shows.
  const [albumPremium, setAlbumPremium] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'leave' | 'cancel' | 'delete' | null>(null);
  const [showNavApps, setShowNavApps] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<Attendee | null>(null);
  const [actingOn, setActingOn] = useState<ActionsPerson | null>(null);
  // People the host let add photos / chat (only loaded for the host).
  const [allowed, setAllowedList] = useState<Allowed[]>([]);
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
  // Opened from the share icon, so the share page has no way back to info.
  const [shareOnly, setShareOnly] = useState(false);
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
    loadEventLimits(eventId).then(setLimits);
    const { data: ev, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();

    // Couldn't reach the server: say so (with Try again) instead of "not
    // found", but keep showing what's already on screen if there is some.
    if (eventError) {
      if (!hasLoadedRef.current) {
        setLoadFailed(true);
        setLoaded(true);
      }
      return;
    }
    setLoadFailed(false);

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

    // Whole rows: is_guest only exists once guest-web.sql has run.
    const { data: profiles } = await supabase.from('profiles').select('*').in('id', ids);

    const nameOf = (id: string) => guestName(profiles?.find((p) => p.id === id));
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
    if (ev.creator_id === session?.user.id && (ev.photos_by === 'host' || ev.chat_by === 'host')) {
      setAllowedList(await loadAllowed(ev.id));
    }
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
      // Opening the event is seeing any change to its name, place or time.
      markEventSeen(eventId);
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



  // Host: let one person add photos / chat, or stop them.
  const toggleAllowed = async (userId: string, kind: PostKind, on: boolean) => {
    if (!event) return;
    hapticLight();
    const result = await saveAllowed(event.id, allowed, userId, kind, on);
    if (result.error) {
      Alert.alert('Could not change that', result.error);
      return;
    }
    setAllowedList(result.allowed);
  };

  const openInfo = () => {
    setShareOnly(false);
    setInfoPage('info');
    setShowInfo(true);
    load();
    supabase.rpc('event_plan', { eid: eventId }).then(({ data, error }) => {
      if (error) return;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { tier: string | null; keep_forever: boolean | null }
        | null
        | undefined;
      setAlbumPremium(!!row && (row.tier !== null || row.keep_forever === true));
    });
  };

  // Straight to the share page (link, QR code and invite code).
  const openShare = () => {
    setShareOnly(true);
    setInfoPage('share');
    setShowInfo(true);
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
    // A photo picked from the roll starts centred (its old frame is cleared).
    setEvent((prev) => (prev ? { ...prev, cover_photo_id: photoId, cover_crop: null } : prev));
    const { error } = await setCoverPhoto(event.id, photoId);
    if (error) Alert.alert('Could not update the event photo', error);
  };


  if (!loaded || !event) {
    return (
      <View style={[styles.screen, styles.center]}>
        {!loaded ? (
          <ActivityIndicator color={colors.accent} />
        ) : loadFailed ? (
          <>
            <Text style={type.h2}>Couldn’t load this event</Text>
            <Text style={[type.bodyMuted, { marginTop: spacing.sm, textAlign: 'center' }]}>
              Check your connection and try again.
            </Text>
            <Button
              title="Try again"
              variant="secondary"
              onPress={() => {
                setLoaded(false);
                load();
              }}
              style={{ marginTop: spacing.lg }}
            />
          </>
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
  const spots = peopleMeter(limits);
  const iconScale = Math.min(1.4, Math.max(1, PixelRatio.getFontScale()));
  // Once it's over, RSVPs are final and read in the past tense.
  const ended = eventEnded(event.ends_at);
  const started = Date.now() >= new Date(event.starts_at).getTime();
  const hostName = attendees.find((a) => a.status === 'host')?.name;
  // The host can remove anyone but themselves, from the person's ··· menu.
  const removableActingOn = isLeader
    ? attendees.find((a) => a.userId === actingOn?.id && a.status !== 'host') ?? null
    : null;
  // Host, on events where only they can add photos or chat: let this
  // person in, or stop them.
  const postActions = removableActingOn
    ? (['photos', 'chat'] as const)
        .filter((kind) => ruleOf(event ?? {}, kind) === 'host')
        .map((kind) => {
          const on = !!allowed.find((a) => a.user_id === removableActingOn.userId)?.[kind];
          const what = kind === 'photos' ? 'add photos' : 'chat';
          return {
            label: on ? `Stop letting them ${what}` : `Let them ${what}`,
            onPress: () => toggleAllowed(removableActingOn.userId, kind, !on),
          };
        })
    : undefined;
  const goingAttendees = attendees.filter(
    (a) => a.status === 'going' || a.status === 'host'
  );
  const goingCount = goingAttendees.length;
  // Where you stand, said in the people tile instead of on its own line.
  const others = goingCount - 1;
  const meLine =
    isLeader || myStatus === 'going'
      ? others > 0
        ? `You + ${others}`
        : isLeader
          ? 'Just you so far'
          : 'You'
      : myStatus === 'maybe'
        ? ended ? 'You said maybe' : "You're a maybe"
        : myStatus === 'not_going'
          ? ended ? "You didn't go" : "You're not going"
          : 'See who';

  // Photos, chat and bills are for the host and people going or maybe
  // (the server checks the same). "Can't go" still sees the event, so they
  // can change their answer.
  const isMember =
    isLeader ||
    myStatus === 'going' ||
    myStatus === 'maybe' ||
    (myStatus === null &&
      invitations.some(
        (row) =>
          row.profile.id === session?.user.id && row.invitation.status === 'accepted'
      ));
  const cantGo = !isLeader && myStatus === 'not_going';

  const openInvite = () => {
    setShareOnly(false);
    setInfoPage('invite');
    setShowInfo(true);
  };
  const mainButton =
    !started && isMember ? (
      <Button title="Invite friends" onPress={openInvite} style={styles.mainButton} />
    ) : ended && albumPhotos.length > 0 ? (
      <Button
        title="Share a recap"
        onPress={() => navigation.navigate('Recap', { eventId: event.id })}
        style={styles.mainButton}
      />
    ) : null;

  const waitingInvites = invitations.filter(
    (row) =>
      row.invitation.status === 'pending' &&
      !attendees.some((a) => a.userId === row.profile.id)
  );

  const {
    beforeOpen,
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
      Alert.alert('Could not reopen adding photos', error);
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



  const keepEvent = async () => {
    const { error } = await supabase.rpc('keep_event', { p_event: event.id });
    if (error) {
      Alert.alert('Could not keep the event', error.message);
      return;
    }
    hapticSuccess();
    load();
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
          <CoverImage
            uri={coverPhoto}
            crop={parseCoverCrop(event.cover_crop)}
            style={[styles.coverContainer, { width: screenWidth }]}
          />
        )}

        <View style={styles.bodyWrap}>
          {started && !ended && (
            <View style={styles.livePill}>
              <Text style={styles.livePillText}>Live now</Text>
            </View>
          )}
          <View style={styles.titleRow}>
            <Text
              maxFontSizeMultiplier={TITLE_MAX_SCALE}
              style={[
                coverPhoto ? styles.titleWithCover : styles.bigDisplayTitle,
                { flex: 1 },
              ]}
            >
              {event.title}
            </Text>
            <View style={styles.headerActions}>
              {isLeader && (
                <Pressable
                  style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}
                  onPress={() =>
                    navigation.navigate('CreateEvent', { editEventId: event.id })
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Manage event"
                >
                  <EditIcon size={Math.round(19 * iconScale)} color={colors.inkMuted} />
                </Pressable>
              )}
              {event.is_link_enabled && (
                <Pressable
                  style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}
                  onPress={openShare}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Share event"
                >
                  <ShareIcon size={Math.round(20 * iconScale)} color={colors.inkMuted} />
                </Pressable>
              )}
            </View>
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
                <Text style={styles.locationText}>{placeLabel(event.location)}</Text>
              </Pressable>
            ) : null}
          </View>

          {activityLine ? (
            <View style={styles.activityWrap}>
              <View style={styles.activityDot} />
              <Text style={styles.activityText}>{activityLine}</Text>
            </View>
          ) : null}

          {event.delete_at ? (
            <View style={[styles.urgentRollBanner, styles.deletingBanner]}>
              <View style={[styles.urgentRollDot, { backgroundColor: colors.danger }]} />
              <Text style={[styles.urgentRollText, { color: colors.danger }]}>
                {isLeader ? 'You deleted this event. ' : 'The host deleted this event. '}
                It goes for good on {formatDay(event.delete_at)} at {formatTime(event.delete_at)}.
                Save any photos you want to keep before then.
              </Text>
              {isLeader && (
                <Pressable onPress={keepEvent} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.keepText}>Keep event</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {/* Under 3 hours left in the film roll upload window */}
          {under3Hours && (
            <View style={styles.urgentRollBanner}>
              <View style={styles.urgentRollDot} />
              <Text style={styles.urgentRollText}>
                Adding photos closes in {timeLeftCopy}. Add yours before then.
              </Text>
            </View>
          )}

          {event.description ? (
            <Text style={[type.body, styles.descriptionText]}>{event.description}</Text>
          ) : null}

          {mainButton}

          {/* Before the event: who's coming and the plan come first, photos
              last. Once it starts, the photos are the point, so they lead. */}
          {started && (
            <>
          <View style={styles.albumGap} />
          {cantGo ? (
            <Text style={[type.bodyMuted, styles.cantGoNote]}>
              Photos, chat and bills are for people going or maybe. Change your answer to join in.
            </Text>
          ) : (
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
            previewCount={9}
            onShowAll={() => navigation.navigate('EventPhotos', { eventId: event.id })}
          />
          )}
            </>
          )}
          {/* Who's going and the chat, side by side as two tiles. */}
          {(goingCount > 0 || isMember) && (
            <>
              <View style={styles.sectionGap} />
              <View style={styles.tileRow}>
                {goingCount > 0 && (
                  <Pressable
                    style={({ pressed }) => [styles.tile, pressed && styles.pressedRow]}
                    onPress={openInfo}
                    accessibilityRole="button"
                    accessibilityLabel={`${goingCount} ${ended ? 'went' : 'going'}. See who`}
                  >
                    <View style={styles.avatarStack}>
                      {goingAttendees.slice(0, 3).map((a, i) => {
                        const isMe = a.userId === session?.user.id;
                        return (
                          <SlideInAvatar
                            key={a.userId}
                            name={a.name}
                            userId={a.userId}
                            avatarUrl={a.avatarUrl}
                            size={26}
                            shouldSlideIn={justRsvpdGoing && isMe}
                            style={[
                              styles.avatarStackRing,
                              { marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i },
                            ]}
                          />
                        );
                      })}
                    </View>
                    <View style={styles.tileText}>
                      <Text style={styles.tileTitle} numberOfLines={1}>
                        {goingCount} {ended ? 'went' : 'going'}
                      </Text>
                      <Text style={styles.chatPreview} numberOfLines={1}>
                        {meLine}
                      </Text>
                    </View>
                  </Pressable>
                )}
                {isMember && (
                  <Pressable
                    style={({ pressed }) => [styles.tile, pressed && styles.pressedRow]}
                    onPress={() =>
                      navigation.navigate('EventChat', {
                        eventId: event.id,
                        title: event.title,
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Event chat"
                  >
                    <View style={styles.chatIconWrap}>
                      <ChatIcon size={Math.round(18 * iconScale)} color={colors.inkMuted} />
                    </View>
                    <View style={styles.tileText}>
                      <View style={styles.tileTitleRow}>
                        <Text style={styles.tileTitle} numberOfLines={1}>
                          Chat
                        </Text>
                        {unreadChats.includes(event.id) && <View style={styles.unreadDot} />}
                      </View>
                      <Text style={styles.chatPreview} numberOfLines={1}>
                        {latestMessage
                          ? `${latestMessage.senderName}: ${latestMessage.body}`
                          : 'Say hello'}
                      </Text>
                    </View>
                  </Pressable>
                )}
              </View>
              {/* The host's spots: "8 of 10 spots taken", and a way to make
                  room once it's nearly full. Guests never see this. */}
              {isLeader && !ended && spots ? (
                <View style={styles.spotsRow}>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{spots.text}</Text>
                  {spots.nearlyFull ? (
                    <Pressable
                      onPress={() => showProPrompt('people')}
                      hitSlop={8}
                      accessibilityRole="button"
                      style={({ pressed }) => pressed && { opacity: 0.6 }}
                    >
                      <Text style={styles.spotsLink}>Make room</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </>
          )}

          {isLeader && joinRequests.length > 0 && (
            <>
              <View style={styles.sectionGap} />
              <SectionLabel>Requests to join</SectionLabel>
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

          {!isLeader && !ended && (
            <>
              <View style={styles.sectionGap} />
              <View style={styles.rsvpHeaderRow}>
                <SectionLabel>Your RSVP</SectionLabel>
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
                ended={ended}
              />
            </>
          )}

          {/* Bills someone already paid toward stay visible after "can't go". */}
          {((isMember && event.bills_enabled !== false) || bills.length > 0) && (
            <>
              <View style={bills.length > 0 ? styles.sectionGap : styles.splitGap} />
              {bills.length > 0 && <SectionLabel>Bills</SectionLabel>}
              {bills.map((b) => (
                <Pressable
                  key={b.bill.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.billRow, pressed && styles.pressedRow]}
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
                  <ChevronRightIcon size={Math.round(16 * iconScale)} color={colors.inkMuted} />
                </Pressable>
              ))}
              {isMember && event.bills_enabled !== false && (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.billRow, pressed && styles.pressedRow]}
                  onPress={() => navigation.navigate('BillReview', { eventId: event.id })}
                >
                  <View style={styles.chatIconWrap}>
                    <PlusIcon size={Math.round(18 * iconScale)} color={colors.inkMuted} />
                  </View>
                  <Text style={[styles.chatTitle, { flex: 1 }]}>Split a bill</Text>
                  <ChevronRightIcon size={Math.round(16 * iconScale)} color={colors.inkMuted} />
                </Pressable>
              )}
            </>
          )}

          {!started && (
            <>
          <View style={styles.albumGap} />
          {cantGo ? (
            <Text style={[type.bodyMuted, styles.cantGoNote]}>
              Photos, chat and bills are for people going or maybe. Change your answer to join in.
            </Text>
          ) : (
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
            previewCount={9}
            onShowAll={() => navigation.navigate('EventPhotos', { eventId: event.id })}
          />
          )}
            </>
          )}
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
        // iOS: a native sheet, which dims the screen itself. Android: the
        // sheet sits on a see-through layer with the scrim, so it fades in
        // place; sliding would carry the scrim up with it.
        animationType={Platform.OS === 'ios' ? 'slide' : 'fade'}
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
                  onPress={() => setInfoPage(shareOnly ? 'share' : 'info')}
                  hitSlop={8}
                >
                  <ArrowIcon size={20} color={colors.ink} direction="left" />
                  <Text style={type.h2}>Invite friends</Text>
                </Pressable>
              ) : infoPage === 'share' && shareOnly ? (
                <Text style={type.h2}>Share</Text>
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
                <Text style={type.h2}>{ended ? 'Who went' : "Who's going"}</Text>
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
                <>
                  {isMember && (
                    <>
                      <Button title="Invite friends" onPress={() => setInfoPage('invite')} />
                      <View style={styles.sheetGap} />
                    </>
                  )}
                  {/* Once it's over, the photos are what's worth sharing;
                      the invite link stays below. */}
                  {ended && albumPhotos.length > 0 && (
                    <>
                      <View style={styles.sheetSection}>
                        <SectionLabel>Share a recap</SectionLabel>
                        <Text style={[type.body, { marginBottom: spacing.md }]}>
                          One picture of the night with the event’s photos, sized for stories.
                        </Text>
                        <Button
                          title="Make a recap"
                          onPress={() => {
                            setShowInfo(false);
                            // After the sheet has faded out.
                            setTimeout(() => navigation.navigate('Recap', { eventId: event.id }), 300);
                          }}
                        />
                      </View>
                      <View style={styles.sheetGap} />
                    </>
                  )}
                  <EventQrPanel event={event} />
                </>
              ) : (
                <>
                  <View style={{ gap: spacing.md }}>
                    {(
                      [
                        {
                          title: rsvpLabel('going', ended),
                          people: attendees.filter(
                            (a) => a.status === 'host' || a.status === 'going'
                          ),
                        },
                        {
                          title: rsvpLabel('maybe', ended),
                          people: attendees.filter((a) => a.status === 'maybe'),
                        },
                        {
                          title: rsvpLabel('not_going', ended),
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
                                    { color: colors.inkMuted, marginRight: spacing.md },
                                  ]}
                                >
                                  {rsvpLabel('host', ended)}
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
                      <View style={styles.sheetGap} />
                      <SectionLabel>
                        Invited · waiting on {waitingInvites.length}
                      </SectionLabel>
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

                  {isMember && (
                    <>
                      <View style={styles.sheetGap} />
                      <Button
                        title="Invite friends"
                        variant="secondary"
                        onPress={() => setInfoPage('invite')}
                      />
                    </>
                  )}
                  {isLeader && withinUploadWindow && (
                    <View style={styles.sheetSection}>
                      <View style={styles.sheetGap} />
                      <SectionLabel>Adding photos</SectionLabel>
                      <View style={styles.switchRow}>
                        <View style={{ flex: 1, paddingRight: spacing.md }}>
                          <Text style={type.body}>Allow uploads</Text>
                          <Text style={type.caption}>
                            {uploadsClosed
                              ? `Closed early. ${hoursLeft} hours left if you reopen it.`
                              : `Open for ${hoursLeft} more hours.`}
                          </Text>
                        </View>
                        <ThemedSwitch
                          value={!uploadsClosed}
                          onValueChange={toggleUploads}
                        />
                      </View>
                    </View>
                  )}

                  {isLeader && !beforeOpen && !withinUploadWindow && (
                    <View style={styles.sheetSection}>
                      <View style={styles.sheetGap} />
                      <SectionLabel>Adding photos</SectionLabel>
                      <Button
                        title="Reopen for 24 hours"
                        variant="secondary"
                        onPress={reopen}
                        style={{ marginTop: spacing.md }}
                      />
                    </View>
                  )}



                  {isMember && !albumPremium && (
                    <>
                      <View style={styles.sheetGap} />
                      <Button
                        title="Keep these photos forever"
                        variant="secondary"
                        onPress={() => {
                          setShowInfo(false);
                          navigation.navigate('Upgrade', { plan: 'party', eventId: event.id });
                        }}
                      />
                    </>
                  )}

                  {/* Guests' two rarer actions, side by side. */}
                  {!isLeader && (
                    <>
                      <View style={styles.sheetGap} />
                      <View style={styles.guestActions}>
                        <Pressable
                          onPress={() => setReportingEvent(true)}
                          hitSlop={8}
                          accessibilityRole="button"
                          style={({ pressed }) => [styles.guestAction, pressed && { opacity: 0.7 }]}
                        >
                          <Text style={styles.reportEventText}>Report event</Text>
                        </Pressable>
                        {myStatus !== null && (
                          <Pressable
                            onPress={() => setConfirmAction('leave')}
                            hitSlop={8}
                            accessibilityRole="button"
                            style={({ pressed }) => [styles.guestAction, pressed && { opacity: 0.7 }]}
                          >
                            <Text style={styles.leaveText}>Leave event</Text>
                          </Pressable>
                        )}
                      </View>
                    </>
                  )}

                  {isLeader && (
                    <>
                      <View style={styles.sheetGap} />
                      <Button
                        title="Manage event"
                        variant="secondary"
                        onPress={() => {
                          setShowInfo(false);
                          navigation.navigate('CreateEvent', { editEventId: event.id });
                        }}
                      />
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
              actions={postActions}
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


          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens, dark = false) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    content: {
      paddingBottom: spacing.xxl,
    },
    coverContainer: {
      aspectRatio: COVER_ASPECT, // what the host framed in the cover cropper
      backgroundColor: c.card,
    },
    bodyWrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
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
    headerButton: {
      minWidth: 36,
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    livePill: {
      alignSelf: 'flex-start',
      backgroundColor: c.live,
      borderRadius: radii.full,
      paddingHorizontal: 10,
      paddingVertical: 3,
      marginBottom: spacing.xs,
    },
    livePillText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: c.onLive,
    },
    mainButton: {
      alignSelf: 'stretch',
      marginTop: spacing.md,
    },
    pressedRow: {
      opacity: 0.7,
      transform: [{ scale: 0.98 }],
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
      borderRadius: radii.card,
      backgroundColor: c.accent + '15',
      borderWidth: 1,
      borderColor: c.accent + '35',
      marginTop: spacing.sm,
    },
    deletingBanner: {
      backgroundColor: c.danger + '12',
      borderColor: c.danger + '35',
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
    // A little wider than the text column, so the pair reads as one band.
    tileRow: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: -spacing.md },
    spotsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    spotsLink: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: c.accentText },
    // Compact rows: picture on the left, two short lines beside it.
    tile: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      // The same stock as the photo strip, so the page reads as one set.
      backgroundColor: filmColors(c, dark).base,
      borderRadius: radii.card,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md - 4,
    },
    tileText: { flex: 1, minWidth: 0 },
    tileTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    tileTitle: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 15,
    },
    whosGoingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    avatarStack: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatarStackRing: {
      borderWidth: 2,
      borderColor: c.paper,
      borderRadius: radii.full,
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
      borderRadius: radii.tag,
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
      paddingVertical: spacing.sm,
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
    sectionGap: { height: SECTION_GAP },
    // The photo strip is a strong shape of its own; it needs less air above.
    albumGap: { height: spacing.lg },
    cantGoNote: { textAlign: 'center', paddingHorizontal: spacing.lg },
    // Between rows of the same group (who's going, chat, split a bill).
    rowGap: { height: spacing.xs },
    // Split a bill on its own, under the tiles: a little more air.
    splitGap: { height: spacing.lg },
    sheetGap: { height: spacing.lg },
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
      borderRadius: radii.card,
      padding: spacing.lg,
    },
    removeOption: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
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
      borderRadius: radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    removeCancelText: {
      ...t.button,
      color: c.ink,
    },
    guestActions: { flexDirection: 'row', gap: spacing.sm },
    guestAction: { flex: 1, alignItems: 'center' },
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
      paddingVertical: spacing.md,
    },
    keepText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.accentText,
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
      borderRadius: radii.card,
      backgroundColor: c.card,
    },
  });
