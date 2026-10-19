import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect } from '@react-navigation/native';
import Avatar from '../components/Avatar';
import PersonActionsSheet, { ActionsPerson } from '../components/PersonActionsSheet';
import { AlertCircleIcon, BellIcon, BellOffIcon, SendIcon } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { useKeyboardShift } from '../hooks/useKeyboardShift';
import {
  ChatMember,
  ChatRoster,
  loadChatRoster,
  loadMessages,
  loadSenderNames,
  sendMessage,
  subscribeToMessages,
} from '../lib/chat';
import { formatMessageTime } from '../lib/dates';
import { hapticLight } from '../lib/haptics';
import { loadBlockedIds } from '../lib/safety';
import { getMutedChats, markChatSeen, setActiveChat, setChatMuted } from '../lib/notifications';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Message } from '../types';

type Props = NativeStackScreenProps<AppStackParamList, 'EventChat'>;

// A pause this long starts a new run, so the time shows again.
const GROUP_GAP_MS = 10 * 60 * 1000;

// How the sender answered, shown beside their name.
const RSVP_LABEL: Record<NonNullable<ChatMember['status']>, string> = {
  host: 'Host',
  going: 'Going',
  maybe: 'Maybe',
  not_going: "Can't go",
};

export default function EventChatScreen({ navigation, route }: Props) {
  const { eventId } = route.params;
  const headerHeight = useHeaderHeight();
  const keyboardShift = useKeyboardShift();
  const { session } = useAuth();
  const userId = session!.user.id;
  const { colors, type } = useTheme();
  const { markRead } = useUnread();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [roster, setRoster] = useState<ChatRoster>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  // The message being acted on (long-press), with its sender.
  const [acting, setActing] = useState<{ message: Message; person: ActionsPerson } | null>(null);
  // Read inside the realtime handler, which is created once.
  const rosterRef = useRef<ChatRoster>({});

  const refreshBlocked = useCallback(async () => {
    setBlockedIds(await loadBlockedIds());
  }, []);
  useFocusEffect(
    useCallback(() => {
      refreshBlocked();
    }, [refreshBlocked])
  );

  // While this chat is on screen, its new messages don't also pop up.
  useFocusEffect(
    useCallback(() => {
      setActiveChat(eventId);
      return () => setActiveChat(null);
    }, [eventId])
  );

  // Per-event mute, kept on the device.
  useEffect(() => {
    getMutedChats(userId).then((ids) => setMuted(ids.includes(eventId)));
  }, [userId, eventId]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    hapticLight();
    await setChatMuted(userId, eventId, next);
  }, [muted, userId, eventId]);

  // A bell in the header turns notifications for this one chat on and off.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={toggleMute}
          hitSlop={12}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          {muted ? (
            <BellOffIcon size={20} color={colors.inkMuted} />
          ) : (
            <BellIcon size={20} color={colors.ink} />
          )}
        </Pressable>
      ),
    });
  }, [navigation, muted, toggleMute, colors]);

  // Anyone who has spoken but isn't on the roster (they left, or were
  // removed) still needs a name - just no RSVP beside it.
  const learnSenders = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !rosterRef.current[id]);
    if (missing.length === 0) return;
    const fetched = await loadSenderNames([...new Set(missing)]);
    const additions: ChatRoster = {};
    for (const [id, info] of Object.entries(fetched)) {
      additions[id] = { name: info.name, avatarUrl: info.avatarUrl, status: null };
    }
    rosterRef.current = { ...rosterRef.current, ...additions };
    setRoster(rosterRef.current);
  }, []);

  const loadData = useCallback(async () => {
    const [rows, members] = await Promise.all([
      loadMessages(eventId),
      loadChatRoster(eventId),
    ]);
    rosterRef.current = members;
    setRoster(members);
    setMessages(rows);
    setLoaded(true);
    if (rows.length > 0) {
      markChatSeen(rows[rows.length - 1].created_at);
      markRead(eventId, rows[rows.length - 1].created_at);
    }
    await learnSenders(rows.map((m) => m.sender_id));
  }, [eventId, learnSenders, markRead]);

  useEffect(() => {
    loadData();

    const channel = subscribeToMessages(eventId, (message) => {
      setMessages((prev) => {
        const tempIdx = prev.findIndex(
          (m) =>
            m.id.startsWith('temp-') &&
            m.sender_id === message.sender_id &&
            m.body === message.body
        );
        if (tempIdx !== -1) {
          const next = [...prev];
          next[tempIdx] = message;
          return next;
        }
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      markChatSeen(message.created_at);
      markRead(eventId, message.created_at);
      learnSenders([message.sender_id]);
    });

    return () => {
      channel.unsubscribe();
    };
  }, [eventId, loadData, learnSenders, markRead]);

  const handleRefresh = useCallback(async () => {
    hapticLight();
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;

    // Optimistic message creation
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      event_id: eventId,
      sender_id: userId,
      body,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setDraft('');
    hapticLight();
    setSending(true);
    setError(null);

    const err = await sendMessage(eventId, userId, body);
    setSending(false);
    if (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(body);
      setError(err);
    }
  };

  // Newest at the bottom: an inverted list keeps that anchored when the
  // keyboard opens, so the data is reversed.
  const rows = useMemo(
    () => messages.filter((m) => !blockedIds.has(m.sender_id)).reverse(),
    [messages, blockedIds]
  );

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const mine = item.sender_id === userId;
    // In an inverted list the earlier message is index + 1 and the later one is index - 1
    const earlier = rows[index + 1];
    const later = rows[index - 1];
    const startsGroup =
      !earlier ||
      earlier.sender_id !== item.sender_id ||
      new Date(item.created_at).getTime() - new Date(earlier.created_at).getTime() >
        GROUP_GAP_MS;
    const endsGroup =
      !later ||
      later.sender_id !== item.sender_id ||
      new Date(later.created_at).getTime() - new Date(item.created_at).getTime() >
        GROUP_GAP_MS;

    if (mine) {
      return (
        <View style={styles.mineGroup}>
          <View style={styles.bubbleMine}>
            <Text style={[type.body, styles.bubbleMineText]}>{item.body}</Text>
          </View>
          {endsGroup && (
            <Text style={styles.timeMine}>{formatMessageTime(item.created_at)}</Text>
          )}
        </View>
      );
    }

    const sender = roster[item.sender_id];
    const status = sender?.status;

    return (
      <View style={styles.theirsGroup}>
        {startsGroup && (
          <View style={styles.senderHeader}>
            <Text style={styles.senderName}>{sender?.name ?? 'Someone'}</Text>
            {status && (
              <Text style={styles.senderStatus}> · {RSVP_LABEL[status]}</Text>
            )}
          </View>
        )}
        <View style={styles.theirsRow}>
          <View style={styles.avatarHolder}>
            {endsGroup ? (
              <Avatar
                userId={item.sender_id}
                name={sender?.name}
                avatarUrl={sender?.avatarUrl}
                size={26}
              />
            ) : null}
          </View>
          <View style={styles.bubbleTheirsCol}>
            <Pressable
              style={styles.bubbleTheirs}
              delayLongPress={350}
              onLongPress={() => {
                hapticLight();
                setActing({
                  message: item,
                  person: {
                    id: item.sender_id,
                    name: sender?.name.split(' ')[0] ?? 'this person',
                  },
                });
              }}
              accessibilityHint="Long press to report or block"
            >
              <Text style={[type.body, styles.bubbleTheirsText]}>{item.body}</Text>
            </Pressable>
            {endsGroup && (
              <Text style={styles.timeTheirs}>{formatMessageTime(item.created_at)}</Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  const hasDraft = draft.trim().length > 0;

  const content = (
    <>
      {!loaded ? (
        <View style={styles.skeletonContainer}>
          <View style={[styles.skeletonBubble, styles.skeletonTheirs, { width: 180 }]} />
          <View style={[styles.skeletonBubble, styles.skeletonTheirs, { width: 230 }]} />
          <View style={[styles.skeletonBubble, styles.skeletonMine, { width: 140 }]} />
          <View style={[styles.skeletonBubble, styles.skeletonTheirs, { width: 200 }]} />
          <View style={[styles.skeletonBubble, styles.skeletonMine, { width: 220 }]} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={[type.bodyMuted, styles.emptyText]}>
            No messages yet. Say hello.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.card}
            />
          }
        />
      )}

      {error && (
        <View style={styles.errorBanner}>
          <AlertCircleIcon size={15} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.inkMuted}
          multiline
          maxLength={1000}
        />
        <Pressable
          onPress={submit}
          disabled={!hasDraft || sending}
          hitSlop={8}
          style={({ pressed }) => [
            styles.sendBtn,
            hasDraft ? styles.sendBtnActive : styles.sendBtnInactive,
            pressed && hasDraft && { transform: [{ scale: 0.95 }], opacity: 0.85 },
          ]}
        >
          <SendIcon
            size={16}
            color={hasDraft ? colors.onAccent : colors.inkMuted}
          />
        </Pressable>
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {Platform.OS === 'android' ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={headerHeight}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        <Animated.View
          style={{
            flex: 1,
            transform: [{ translateY: Animated.multiply(keyboardShift, -1) }],
          }}
        >
          {content}
        </Animated.View>
      )}
      <PersonActionsSheet
        person={acting?.person ?? null}
        report={
          acting
            ? {
                target: 'message',
                targetId: acting.message.id,
                subject: 'this message',
                label: 'Report message',
              }
            : undefined
        }
        onClose={() => setActing(null)}
        onBlocked={refreshBlocked}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
    },
    emptyText: {
      textAlign: 'center',
      lineHeight: 20,
    },
    skeletonContainer: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
    skeletonBubble: {
      height: 38,
      borderRadius: 16,
      backgroundColor: c.card,
    },
    skeletonTheirs: {
      alignSelf: 'flex-start',
      opacity: 0.6,
    },
    skeletonMine: {
      alignSelf: 'flex-end',
      opacity: 0.35,
    },
    list: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    mineGroup: {
      alignSelf: 'flex-end',
      alignItems: 'flex-end',
      maxWidth: '80%',
      marginBottom: 3,
    },
    bubbleMine: {
      backgroundColor: c.accent,
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: 16,
      borderBottomRightRadius: 4,
    },
    bubbleMineText: {
      color: c.onAccent,
    },
    timeMine: {
      ...t.caption,
      fontSize: 11,
      color: c.inkMuted,
      marginTop: 3,
      marginBottom: spacing.xs,
    },
    theirsGroup: {
      alignSelf: 'flex-start',
      maxWidth: '82%',
      marginBottom: 3,
    },
    senderHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 34,
      marginBottom: 3,
      marginTop: spacing.xs,
    },
    senderName: {
      ...t.caption,
      fontFamily: fonts.bodyMedium,
      color: c.ink,
      fontSize: 12,
    },
    senderStatus: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 12,
    },
    theirsRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    avatarHolder: {
      width: 26,
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bubbleTheirsCol: {
      flexShrink: 1,
      alignItems: 'flex-start',
    },
    bubbleTheirs: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: 16,
      borderBottomLeftRadius: 4,
    },
    bubbleTheirsText: {
      color: c.ink,
    },
    timeTheirs: {
      ...t.caption,
      fontSize: 11,
      color: c.inkMuted,
      marginTop: 3,
      marginBottom: spacing.xs,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.xs,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: c.card,
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    errorText: {
      ...t.caption,
      color: c.danger,
      flex: 1,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
      backgroundColor: c.paper,
    },
    input: {
      ...t.body,
      flex: 1,
      maxHeight: 120,
      minHeight: 38,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 19,
      paddingHorizontal: 14,
      paddingTop: Platform.OS === 'ios' ? 9 : 6,
      paddingBottom: Platform.OS === 'ios' ? 9 : 6,
      color: c.ink,
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnActive: {
      backgroundColor: c.accent,
    },
    sendBtnInactive: {
      backgroundColor: 'transparent',
    },
  });
