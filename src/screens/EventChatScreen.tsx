// An event's group chat. Updates arrive live and new messages appear before
// they are confirmed. Messages from blocked people are hidden. Each chat can
// be muted on this phone, and long-press opens report and block.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect } from '@react-navigation/native';
import Avatar from '../components/Avatar';
import ConfirmDialog from '../components/ConfirmDialog';
import SwipeToReply from '../components/SwipeToReply';
import PersonActionsSheet, { ActionsPerson } from '../components/PersonActionsSheet';
import { AlertCircleIcon, BellIcon, BellOffIcon, CloseIcon, SendIcon } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { useKeyboardShift } from '../hooks/useKeyboardShift';
import {
  ChatRoster,
  loadChatRoster,
  loadMessages,
  loadSenderNames,
  sendMessage,
  subscribeToMessages,
  canStillEdit,
  deleteMessage,
  editMessage,
} from '../lib/chat';
import {
  ChatReads,
  loadChatReads,
  markChatReadShared,
  seenPositions,
  subscribeToChatReads,
} from '../lib/chatReads';
import { formatChatDivider, formatMessageTime, startsChatTimeBlock } from '../lib/dates';
import { rsvpLabel } from '../lib/rsvpLabels';
import { hapticLight } from '../lib/haptics';
import { loadBlockedIds } from '../lib/safety';
import { getMutedChats, markChatSeen, setActiveChat, setChatMuted } from '../lib/notifications';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Message } from '../types';
import { supabase } from '../lib/supabase';
import { loadAllowed } from '../lib/postPermissions';
import { mayPost, POST_BLOCKED_NOTE } from '../lib/postRules';

type Props = NativeStackScreenProps<AppStackParamList, 'EventChat'>;

// A pause this long starts a new run, so the time shows again.
const GROUP_GAP_MS = 10 * 60 * 1000;

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
  // Whether this person may send (the host can make chat host-only). Starts
  // true so the box doesn't flicker away; the database decides either way.
  const [canChat, setCanChat] = useState(true);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const { data: ev } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
        if (!ev || !live) return;
        const allowed = ev.chat_by === 'host' && ev.creator_id !== userId ? await loadAllowed(eventId) : [];
        if (live) setCanChat(mayPost(ev, userId, 'chat', allowed));
      })();
      return () => {
        live = false;
      };
    }, [eventId, userId])
  );
  // The event is over, so answers read "Went" and "Didn't go".
  const [ended, setEnded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  // When each member last read this chat, for "Seen by".
  const [reads, setReads] = useState<ChatReads>({});
  // The message being acted on (long-press), with its sender.
  const [acting, setActing] = useState<{ message: Message; person: ActionsPerson } | null>(null);
  const insets = useSafeAreaInsets();
  // Long-press menu on your own message (Edit, Delete).
  const [ownMenu, setOwnMenu] = useState<Message | null>(null);
  // The message whose text is in the box being edited, if any.
  const [editing, setEditing] = useState<Message | null>(null);
  // The message the next one answers, shown above the box.
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  // The message a tapped quote jumped to, lit up for a moment.
  const [flashId, setFlashId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  // Waiting on "Delete this message?".
  const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<Message | null>(null);
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
    const [rows, { members, ended: over }, readTimes] = await Promise.all([
      loadMessages(eventId),
      loadChatRoster(eventId),
      loadChatReads(eventId),
    ]);
    rosterRef.current = members;
    setRoster(members);
    setEnded(over);
    setMessages(rows);
    setReads(readTimes);
    setLoaded(true);
    // Tell the others this person has read up to now.
    markChatReadShared(eventId);
    if (rows.length > 0) {
      markChatSeen(rows[rows.length - 1].created_at);
      markRead(eventId, rows[rows.length - 1].created_at);
    }
    await learnSenders([...rows.map((m) => m.sender_id), ...Object.keys(readTimes)]);
  }, [eventId, learnSenders, markRead]);

  useEffect(() => {
    loadData();

    const stopMessages = subscribeToMessages(eventId, (message) => {
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
      if (message.sender_id !== userId) markChatReadShared(eventId);
      learnSenders([message.sender_id]);
    },
    // An edit: new text, same place.
    (updated) =>
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))),
    // A deletion, by its sender or the host.
    (deletedId) => setMessages((prev) => prev.filter((m) => m.id !== deletedId))
    );

    const stopReads = subscribeToChatReads(eventId, (readerId, lastReadAt) => {
      setReads((prev) =>
        prev[readerId] && prev[readerId] >= lastReadAt ? prev : { ...prev, [readerId]: lastReadAt }
      );
      learnSenders([readerId]);
    });

    // Live updates don't replay what came in while the phone was locked or
    // in the background, so catch up when it's back.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadData();
    });

    return () => {
      stopMessages();
      stopReads();
      appState.remove();
    };
  }, [eventId, userId, loadData, learnSenders, markRead]);

  const handleRefresh = useCallback(async () => {
    hapticLight();
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  // The host can delete anyone's message (the server checks it too).
  const isHost = roster[userId]?.status === 'host';

  const startReply = (message: Message) => {
    setEditing(null);
    setReplyingTo(message);
    setError(null);
  };

  const startEdit = (message: Message) => {
    setReplyingTo(null);
    setEditing(message);
    setDraft(message.body);
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };

  const saveEdit = async (message: Message, body: string) => {
    if (body === message.body) {
      cancelEdit();
      return;
    }
    setSending(true);
    setError(null);
    const result = await editMessage(message.id, body);
    setSending(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    hapticLight();
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, body, edited_at: result.editedAt } : m))
    );
    cancelEdit();
  };

  const confirmDelete = async () => {
    const message = confirmDeleteMsg;
    setConfirmDeleteMsg(null);
    if (!message) return;
    const err = await deleteMessage(message.id);
    if (err) {
      setError(err);
      return;
    }
    hapticLight();
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    if (editing?.id === message.id) cancelEdit();
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (editing) {
      await saveEdit(editing, body);
      return;
    }

    // Optimistic message creation
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      event_id: eventId,
      sender_id: userId,
      body,
      created_at: new Date().toISOString(),
      reply_to: replyingTo?.id ?? null,
    };
    const replyTo = replyingTo;

    setMessages((prev) => [...prev, optimisticMsg]);
    setDraft('');
    setReplyingTo(null);
    hapticLight();
    setSending(true);
    setError(null);

    const err = await sendMessage(eventId, userId, body, replyTo?.id);
    setSending(false);
    if (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(body);
      setReplyingTo(replyTo);
      setError(err);
    }
  };

  // Newest at the bottom: an inverted list keeps that anchored when the
  // keyboard opens, so the data is reversed.
  const rows = useMemo(
    () => messages.filter((m) => !blockedIds.has(m.sender_id)).reverse(),
    [messages, blockedIds]
  );

  // Each person's "seen" mark sits under the last message they've read
  // (lib/seenBy). Blocked people don't show.
  const seenAt = useMemo(() => {
    const visible: ChatReads = {};
    for (const [id, at] of Object.entries(reads)) if (!blockedIds.has(id)) visible[id] = at;
    return seenPositions(visible, rows, userId);
  }, [reads, rows, userId, blockedIds]);
  // Which messages' seen rows are opened up to show everyone.
  const [openSeen, setOpenSeen] = useState<Set<string>>(new Set());
  // The one message whose exact time is showing (tap a message to see it).
  const [timeShownId, setTimeShownId] = useState<string | null>(null);
  const toggleTime = (id: string) => setTimeShownId((cur) => (cur === id ? null : id));
  const toggleSeen = (messageId: string) =>
    setOpenSeen((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

  // Up to three faces show as they are; more fold into two faces and "+N".
  // Tapping any seen row opens it up: every face, with their names on the
  // line under. Tapping again folds it back.
  const renderSeen = (item: Message, mine: boolean) => {
    const ids = seenAt.get(item.id);
    if (!ids || ids.length === 0) return null;
    const open = openSeen.has(item.id);
    const folded = ids.length > 3 && !open;
    const shown = folded ? ids.slice(0, 2) : ids;
    const names = ids.map((id) => roster[id]?.name ?? 'Someone');
    return (
      <Pressable
        onPress={() => toggleSeen(item.id)}
        hitSlop={8}
        style={[styles.seenBlock, mine ? styles.seenMine : styles.seenTheirs]}
        accessibilityRole="button"
        accessibilityLabel={`Seen by ${names.join(', ')}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={[styles.seenRow, mine && styles.seenRowMine]}>
          {shown.map((id) => (
            <Avatar
              key={id}
              userId={id}
              name={roster[id]?.name}
              avatarUrl={roster[id]?.avatarUrl}
              size={18}
            />
          ))}
          {folded && (
            <View style={styles.seenMore}>
              <Text style={styles.seenMoreText}>+{ids.length - 2}</Text>
            </View>
          )}
        </View>
        {open && (
          <Text style={[styles.seenNames, mine && { textAlign: 'right' }]}>
            {names.join(', ')}
          </Text>
        )}
      </Pressable>
    );
  };

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const nameOf = (id: string) =>
    id === userId ? 'You' : (roster[id]?.name.split(' ')[0] ?? 'Someone');

  // The quoted message inside a reply's bubble. It may be gone (deleted, or
  // older than what's loaded).
  const jumpTo = (messageId: string) => {
    const index = rows.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    hapticLight();
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setFlashId(messageId);
    setTimeout(() => setFlashId((id) => (id === messageId ? null : id)), 1600);
  };

  const renderQuote = (item: Message, mine: boolean) => {
    if (!item.reply_to) return null;
    const quoted = byId.get(item.reply_to);
    const hidden = quoted && blockedIds.has(quoted.sender_id);
    return (
      <Pressable
        style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}
        onPress={quoted && !hidden ? () => jumpTo(quoted.id) : undefined}
        accessibilityRole={quoted && !hidden ? 'button' : undefined}
        accessibilityHint={quoted && !hidden ? 'Shows the original message' : undefined}
      >
        {quoted && !hidden ? (
          <>
            <Text style={[styles.quoteName, mine && styles.quoteTextMine]}>{nameOf(quoted.sender_id)}</Text>
            <Text style={[styles.quoteBody, mine && styles.quoteTextMine]} numberOfLines={2}>
              {quoted.body}
            </Text>
          </>
        ) : (
          <Text style={[styles.quoteBody, mine && styles.quoteTextMine]}>
            {quoted ? 'Message from someone you blocked' : 'Earlier message, no longer here'}
          </Text>
        )}
      </Pressable>
    );
  };

  // Every message can be swiped right to reply (once the server has it).
  // A time line sits above the first message of each day or after a long
  // pause; it stays put while the message slides.
  const renderItem = ({ item, index }: { item: Message; index: number }) => (
    <View>
      {startsChatTimeBlock(rows[index + 1]?.created_at, item.created_at) && (
        <Text style={styles.timeDivider}>{formatChatDivider(item.created_at)}</Text>
      )}
      <SwipeToReply onReply={() => startReply(item)} disabled={item.id.startsWith('temp-')}>
        <View style={flashId === item.id ? styles.flash : undefined}>{renderMessage(item, index)}</View>
      </SwipeToReply>
    </View>
  );

  const renderMessage = (item: Message, index: number) => {
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
          <Pressable
            style={[styles.bubbleMine, editing?.id === item.id && styles.bubbleEditing]}
            onPress={() => toggleTime(item.id)}
            delayLongPress={350}
            onLongPress={() => {
              // Not until the server has it (it has no real id yet).
              if (item.id.startsWith('temp-')) return;
              hapticLight();
              setOwnMenu(item);
            }}
            accessibilityHint="Tap for the time. Long press to reply, edit or delete"
          >
            {renderQuote(item, true)}
            <Text style={[type.body, styles.bubbleMineText]}>{item.body}</Text>
          </Pressable>
          {(timeShownId === item.id || item.edited_at) && (
            <Text style={styles.timeMine}>
              {item.edited_at ? 'Edited' : ''}
              {item.edited_at && timeShownId === item.id ? ' · ' : ''}
              {timeShownId === item.id ? formatMessageTime(item.created_at) : ''}
            </Text>
          )}
          {renderSeen(item, true)}
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
              <Text style={styles.senderStatus}> · {rsvpLabel(status, ended)}</Text>
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
              onPress={() => toggleTime(item.id)}
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
              accessibilityHint="Tap for the time. Long press to reply, report or block"
            >
              {renderQuote(item, false)}
              <Text style={[type.body, styles.bubbleTheirsText]}>{item.body}</Text>
            </Pressable>
            {(timeShownId === item.id || item.edited_at) && (
              <Text style={styles.timeTheirs}>
                {item.edited_at ? 'Edited' : ''}
                {item.edited_at && timeShownId === item.id ? ' · ' : ''}
                {timeShownId === item.id ? formatMessageTime(item.created_at) : ''}
              </Text>
            )}
          </View>
        </View>
        {renderSeen(item, false)}
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
          ref={listRef}
          data={rows}
          inverted
          onScrollToIndexFailed={(info) => {
            // Not laid out yet: get close, then try again.
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
            setTimeout(
              () => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5 }),
              250
            );
          }}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          extraData={[seenAt, flashId, timeShownId]}
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

      {!canChat ? (
        <View style={[styles.composer, styles.chatClosed]}>
          <Text style={type.caption}>{POST_BLOCKED_NOTE.chat}</Text>
        </View>
      ) : (
      <>
      {replyingTo && !editing && (
        <View style={styles.editBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.editBarText}>
              Replying to{' '}
              {replyingTo.sender_id === userId ? 'yourself' : nameOf(replyingTo.sender_id)}
            </Text>
            <Text style={styles.replyBarBody} numberOfLines={1}>
              {replyingTo.body}
            </Text>
          </View>
          <Pressable
            onPress={() => setReplyingTo(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
          >
            <CloseIcon size={16} color={colors.inkMuted} />
          </Pressable>
        </View>
      )}
      {editing && (
        <View style={styles.editBar}>
          <Text style={styles.editBarText}>Editing message</Text>
          <Pressable onPress={cancelEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel editing">
            <CloseIcon size={16} color={colors.inkMuted} />
          </Pressable>
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
      )}
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
        // The host can take anyone's message down.
        extra={
          acting && isHost
            ? { label: 'Delete message', onPress: () => setConfirmDeleteMsg(acting.message) }
            : undefined
        }
        primary={
          acting ? { label: 'Reply', onPress: () => startReply(acting.message) } : undefined
        }
        onClose={() => setActing(null)}
        onBlocked={refreshBlocked}
      />

      {/* Your own message: edit (for 10 minutes) or delete. Faded in over the
          scrim, like every other menu. */}
      <Modal visible={!!ownMenu} transparent animationType="fade" onRequestClose={() => setOwnMenu(null)}>
        <View style={styles.menuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOwnMenu(null)} accessibilityLabel="Close" />
          <View style={[styles.menuCard, { marginBottom: insets.bottom + spacing.xl }]} accessibilityViewIsModal>
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}
              onPress={() => {
                const m = ownMenu;
                setOwnMenu(null);
                if (m) startReply(m);
              }}
              accessibilityRole="button"
            >
              <Text style={type.body}>Reply</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            {ownMenu && canStillEdit(ownMenu) && (
              <>
                <Pressable
                  style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    const m = ownMenu;
                    setOwnMenu(null);
                    startEdit(m);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={type.body}>Edit message</Text>
                </Pressable>
                <View style={styles.menuDivider} />
              </>
            )}
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}
              onPress={() => {
                const m = ownMenu;
                setOwnMenu(null);
                // After the menu has faded; iOS drops a dialog opened mid-close.
                setTimeout(() => setConfirmDeleteMsg(m), 350);
              }}
              accessibilityRole="button"
            >
              <Text style={[type.body, { color: colors.danger }]}>Delete message</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}
              onPress={() => setOwnMenu(null)}
              accessibilityRole="button"
            >
              <Text style={[type.body, { color: colors.inkMuted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!confirmDeleteMsg}
        title="Delete this message?"
        message="It’s removed for everyone in the chat."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteMsg(null)}
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
      borderRadius: radii.card,
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
      borderRadius: radii.card,
      borderBottomRightRadius: 4,
    },
    bubbleMineText: {
      color: c.onAccent,
    },
    // The whole seen mark: faces, and names under them when opened.
    seenBlock: {
      marginTop: 2,
      marginBottom: spacing.xs,
      maxWidth: '80%',
    },
    // Under my bubbles on the right; under theirs, in line with the bubbles.
    seenMine: {
      alignSelf: 'flex-end',
      alignItems: 'flex-end',
    },
    seenTheirs: {
      alignSelf: 'flex-start',
      alignItems: 'flex-start',
      marginLeft: 34,
    },
    seenRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 3,
    },
    seenRowMine: {
      justifyContent: 'flex-end',
    },
    seenNames: {
      ...t.caption,
      fontSize: 11,
      color: c.inkMuted,
      marginTop: 3,
    },
    seenMore: {
      height: 18,
      minWidth: 18,
      paddingHorizontal: 5,
      borderRadius: 9,
      backgroundColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seenMoreText: {
      ...t.caption,
      fontSize: 10,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    timeDivider: {
      ...t.caption,
      fontSize: 11,
      color: c.inkMuted,
      textAlign: 'center',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
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
      borderRadius: radii.card,
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
      borderRadius: radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    errorText: {
      ...t.caption,
      color: c.danger,
      flex: 1,
    },
    // Your bubble while its text is in the box being edited.
    bubbleEditing: {
      opacity: 0.6,
    },
    editBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
      backgroundColor: c.paper,
    },
    editBarText: {
      ...t.caption,
      color: c.inkMuted,
    },
    replyBarBody: {
      ...t.caption,
      color: c.ink,
      marginTop: 1,
    },
    flash: { backgroundColor: c.accent + '1F', borderRadius: radii.control },
    // The quoted message at the top of a reply bubble.
    quote: {
      borderRadius: radii.control,
      paddingVertical: 5,
      paddingHorizontal: 9,
      marginBottom: 6,
      marginHorizontal: -6,
    },
    quoteMine: { backgroundColor: 'rgba(255,255,255,0.18)' },
    quoteTheirs: { backgroundColor: c.paper },
    quoteName: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: c.ink,
    },
    quoteBody: {
      ...t.caption,
      fontSize: 13,
      color: c.inkMuted,
    },
    quoteTextMine: { color: c.onAccent, opacity: 0.9 },
    menuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.scrim },
    menuCard: {
      marginHorizontal: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      paddingHorizontal: spacing.lg,
    },
    menuRow: {
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    menuDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
    },
    chatClosed: { paddingVertical: spacing.md, justifyContent: 'center' },
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
      borderRadius: radii.full,
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
