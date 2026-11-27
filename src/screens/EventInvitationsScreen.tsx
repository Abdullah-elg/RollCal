// Invitations to events that the user hasn't answered yet, to accept or
// decline.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BellIcon, CalendarIcon, ChevronRightIcon, MapPinIcon } from '../components/icons';
import { Button, PageIntro } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { formatDay, formatTime } from '../lib/dates';
import { hapticLight, hapticMedium } from '../lib/haptics';
import {
  acceptInvitation,
  declineInvitation,
  loadPendingInvitations,
  PendingInvitation,
} from '../lib/invitations';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { placeLabel } from '../lib/place';

type Props = NativeStackScreenProps<AppStackParamList, 'EventInvitations'>;

export default function EventInvitationsScreen({ navigation }: Props) {
  const { session } = useAuth();
  const userId = session!.user.id;
  const { colors, type } = useTheme();
  const { refresh: refreshUnread } = useUnread();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  const [invites, setInvites] = useState<PendingInvitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await loadPendingInvitations(userId);
      setInvites(data);
    } catch {
      // Keep existing list on transient fetch error
    } finally {
      setLoaded(true);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    hapticLight();
    setRefreshing(true);
    await load();
    await refreshUnread();
    setRefreshing(false);
  };

  const handleAnswer = async (item: PendingInvitation, accept: boolean) => {
    hapticLight();
    setAnswering(item.invitation.id);

    const err = accept
      ? await acceptInvitation(item.invitation, userId)
      : await declineInvitation(item.invitation.id);

    setAnswering(null);

    if (err) {
      Alert.alert(accept ? 'Could not accept' : 'Could not decline', err);
      return;
    }

    if (accept) {
      hapticMedium();
    }

    // Refresh invitations and unread count
    await Promise.all([load(), refreshUnread()]);

    if (accept) {
      navigation.navigate('EventDetail', { eventId: item.event.id });
    }
  };

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
      <PageIntro icon={BellIcon}>
        {invites.length > 0
          ? `${invites.length} ${
              invites.length === 1 ? 'invitation waiting' : 'invitations waiting'
            }`
          : 'Nothing waiting'}
      </PageIntro>

      {!loaded ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : invites.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptyBody}>
            When friends invite you to events, they will show up here.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {invites.map((item) => {
            const isProcessing = answering === item.invitation.id;
            return (
              <View key={item.invitation.id} style={styles.inviteCard}>
                <Pressable
                  style={styles.cardHeader}
                  onPress={() =>
                    navigation.navigate('EventDetail', { eventId: item.event.id })
                  }
                >
                  <View style={styles.headerInfo}>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {item.event.title}
                    </Text>
                    <Text style={styles.hostSubtitle}>
                      {item.hostName} invited you
                    </Text>
                  </View>
                  <ChevronRightIcon size={16} color={colors.inkMuted} />
                </Pressable>

                <View style={styles.metaRow}>
                  <CalendarIcon size={14} color={colors.inkMuted} />
                  <Text style={styles.metaText}>
                    {formatDay(item.event.starts_at)} · {formatTime(item.event.starts_at)}
                  </Text>
                </View>

                {item.event.location ? (
                  <View style={styles.metaRow}>
                    <MapPinIcon size={14} color={colors.inkMuted} />
                    <Text style={styles.metaText} numberOfLines={1}>
                      {placeLabel(item.event.location)}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <Button
                    title={isProcessing ? 'Saving…' : 'Accept'}
                    onPress={() => handleAnswer(item, true)}
                    disabled={isProcessing}
                    style={styles.actionBtn}
                  />
                  <Button
                    title="Decline"
                    variant="secondary"
                    onPress={() => handleAnswer(item, false)}
                    disabled={isProcessing}
                    style={styles.actionBtn}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    loadingWrap: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
    },
    emptyWrap: {
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.sm,
      gap: spacing.xs,
    },
    emptyTitle: {
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 16,
    },
    emptyBody: {
      ...t.bodyMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    list: {
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    inviteCard: {
      backgroundColor: c.card,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: radii.card,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    headerInfo: {
      flex: 1,
      gap: 2,
    },
    eventTitle: {
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 17,
      lineHeight: 22,
    },
    hostSubtitle: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 13,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    metaText: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 13,
      flex: 1,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    actionBtn: {
      flex: 1,
      height: 40,
    },
  });
