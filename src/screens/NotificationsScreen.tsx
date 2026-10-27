// The bell on Home: new things first, then what you've already seen (kept
// for 2 days, or until you answer a request). Chats show once each, with
// their latest message. Tapping goes to where it happened.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Avatar from '../components/Avatar';
import { BellIcon, ChatIcon } from '../components/icons';
import { EmptyNote, SectionLabel } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { formatDay, formatTime } from '../lib/dates';
import { hapticLight } from '../lib/haptics';
import { Inbox, InboxItem, loadInbox, markInboxSeen } from '../lib/inbox';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'Notifications'>;

// "Just now", "12m", "3h", then "Sat, Oct 24".
function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  if (mins < 48 * 60) return `Yesterday, ${formatTime(iso)}`;
  return formatDay(iso);
}

export default function NotificationsScreen({ navigation }: Props) {
  const { session } = useAuth();
  const userId = session!.user.id;
  const { colors, type } = useTheme();
  const { refresh: refreshUnread } = useUnread();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // What was new when the screen opened stays marked as new while you're
  // here, even though it now counts as seen.
  const newThisVisit = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const next = await loadInbox(userId);
      next.fresh.forEach((i) => newThisVisit.current.add(i.key));
      setInbox(next);
      await markInboxSeen(userId, [...next.fresh, ...next.earlier].map((i) => i.key));
    } catch {
      // Keep what's on screen; pull to refresh tries again.
      setInbox((prev) => prev ?? { fresh: [], earlier: [] });
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    hapticLight();
    setRefreshing(true);
    await Promise.all([load(), refreshUnread()]);
    setRefreshing(false);
  };

  const open = (item: InboxItem) => {
    hapticLight();
    const t = item.target;
    if (t.kind === 'chat') navigation.navigate('EventChat', { eventId: t.eventId, title: t.title });
    else if (t.kind === 'event') navigation.navigate('EventDetail', { eventId: t.eventId });
    else if (t.kind === 'bill') navigation.navigate('Bill', { billId: t.billId });
    else if (t.kind === 'invitations') navigation.navigate('EventInvitations');
    else if (t.kind === 'friendRequests') navigation.navigate('FriendRequests');
    else navigation.navigate('Tabs', { screen: 'FriendsTab' });
  };

  const renderRow = (item: InboxItem) => {
    const isNew = newThisVisit.current.has(item.key);
    return (
      <Pressable
        key={item.key}
        onPress={() => open(item)}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`${isNew ? 'New. ' : ''}${item.title}. ${item.body}`}
      >
        <View style={styles.lead}>
          {item.personId ? (
            <Avatar
              userId={item.personId}
              name={item.personName}
              avatarUrl={item.avatarUrl}
              size={40}
            />
          ) : (
            <View style={styles.iconCircle}>
              <BellIcon size={18} color={colors.inkMuted} />
            </View>
          )}
          {item.kind === 'chat' && (
            <View style={styles.kindBadge}>
              <ChatIcon size={11} color={colors.inkMuted} />
            </View>
          )}
        </View>
        <View style={styles.rowText}>
          <View style={styles.rowTop}>
            <Text style={[styles.rowTitle, isNew && styles.rowTitleNew]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.rowTime}>{ago(item.at)}</Text>
          </View>
          <Text style={styles.rowBody} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        {isNew && <View style={styles.newDot} accessibilityElementsHidden />}
      </Pressable>
    );
  };

  const fresh = inbox?.fresh ?? [];
  const earlier = inbox?.earlier ?? [];

  return (
    <ScrollView
      style={styles.screen}
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
      {!inbox ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : fresh.length === 0 && earlier.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptyBody}>
            Messages, invitations, friend requests and new photos show up here.
          </Text>
        </View>
      ) : (
        <>
          <SectionLabel count={fresh.length}>New</SectionLabel>
          {fresh.length > 0 ? fresh.map(renderRow) : <EmptyNote>Nothing new since you last looked.</EmptyNote>}
          {earlier.length > 0 && (
            <>
              <SectionLabel style={{ marginTop: spacing.lg }}>Earlier</SectionLabel>
              {earlier.map(renderRow)}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl },
    loadingWrap: { paddingVertical: spacing.xl, alignItems: 'center' },
    emptyWrap: { paddingVertical: spacing.xl, paddingHorizontal: spacing.sm, gap: spacing.xs },
    emptyTitle: { fontFamily: fonts.bodySemiBold, color: c.ink, fontSize: 16 },
    emptyBody: { ...t.bodyMuted, fontSize: 14, lineHeight: 20 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
      minHeight: 64,
    },
    lead: { width: 40, height: 40 },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // A small chat mark on the avatar's corner, so chats read apart at a glance.
    kindBadge: {
      position: 'absolute',
      right: -3,
      bottom: -3,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: { flex: 1, gap: 2 },
    rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    rowTitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: c.ink },
    rowTitleNew: { fontFamily: fonts.bodySemiBold },
    rowTime: { ...t.caption, fontSize: 12, color: c.inkMuted },
    rowBody: { ...t.caption, fontSize: 14, lineHeight: 19, color: c.inkMuted },
    newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent },
  });
