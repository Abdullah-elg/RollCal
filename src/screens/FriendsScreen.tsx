// The Friends tab: the friends list, with links to find people, requests
// received and requests sent. Blocking someone also ends the friendship.

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ConfirmDialog from '../components/ConfirmDialog';
import { InboxIcon, SearchIcon, SendIcon } from '../components/icons';
import PersonActionsSheet from '../components/PersonActionsSheet';
import { MoreAction, PersonList, PersonRow, RowAction } from '../components/PersonRow';
import { SectionLabel } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useFriendData } from '../hooks/useFriendData';
import { FriendLink, removeFriendship } from '../lib/friends';
import { TabScreenProps } from '../navigation/types';
import {
  tabBarHeight,
  fonts,
  Palette,
  spacing,
  TypeTokens,
} from '../theme';

type Props = TabScreenProps<'FriendsTab'>;

export default function FriendsScreen({ navigation }: Props) {
  const { profile } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const { data, loaded, refreshing, refresh, reload } = useFriendData();
  const insets = useSafeAreaInsets();
  const bottomInset =
    Platform.OS === 'ios'
      ? insets.bottom + tabBarHeight
      : 0;
  const [unfriend, setUnfriend] = useState<FriendLink | null>(null);
  const [acting, setActing] = useState<FriendLink | null>(null);

  const drop = async (link: FriendLink) => {
    await removeFriendship(link.friendshipId);
    reload();
  };

  // The three ways into the rest of the friends flow. Counts come along so
  // you can see there's something waiting without opening anything.
  const destinations = [
    {
      label: 'Search',
      caption: 'by name',
      icon: SearchIcon,
      onPress: () => navigation.navigate('FindPeople'),
    },
    {
      label: 'Requests',
      caption: data.incoming.length > 0 ? `${data.incoming.length} waiting` : 'none',
      icon: InboxIcon,
      // A waiting request earns the filled treatment - it's the one thing
      // on this screen that wants acting on.
      highlight: data.incoming.length > 0,
      onPress: () => navigation.navigate('FriendRequests'),
    },
    {
      label: 'Sent',
      caption: data.outgoing.length > 0 ? `${data.outgoing.length} pending` : 'none',
      icon: SendIcon,
      onPress: () => navigation.navigate('SentRequests'),
    },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={type.title}>Friends</Text>
        {profile?.username ? (
          <Text style={[type.caption, { marginTop: spacing.xs }]}>
            You're @{profile.username}. Share it so people can find you.
          </Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomInset + spacing.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        }
      >
        <View style={styles.buttonRow}>
          {destinations.map((d) => {
            const Icon = d.icon;
            return (
              <Pressable
                key={d.label}
                onPress={d.onPress}
                style={({ pressed }) => [
                  styles.navButton,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {d.highlight && <View style={styles.unreadDot} />}
                <Icon size={20} color={colors.ink} />
                <Text style={styles.navLabel}>{d.label}</Text>
                <Text
                  style={[
                    styles.navCaption,
                    d.highlight && { color: colors.danger, fontFamily: fonts.bodySemiBold },
                  ]}
                  numberOfLines={1}
                >
                  {d.caption}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel count={data.friends.length}>Your friends</SectionLabel>
        {!loaded ? (
          <ActivityIndicator color={colors.accent} />
        ) : data.friends.length === 0 ? (
          <Text style={[type.bodyMuted, { paddingVertical: spacing.md }]}>
            No friends yet. Search for someone above. Once you're friends, you
            can invite them straight to an event.
          </Text>
        ) : (
          <PersonList>
            {data.friends.map((link) => (
              <PersonRow key={link.friendshipId} person={link.profile}>
                <RowAction
                  label="Remove"
                  tone="danger"
                  onPress={() => setUnfriend(link)}
                />
                <MoreAction
                  name={link.profile.display_name}
                  onPress={() => setActing(link)}
                />
              </PersonRow>
            ))}
          </PersonList>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={unfriend !== null}
        title={`Remove ${unfriend?.profile.display_name ?? ''}?`}
        message="You'll both drop off each other's friends list. You can always send a new request later."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const link = unfriend;
          setUnfriend(null);
          if (link) drop(link);
        }}
        onCancel={() => setUnfriend(null)}
      />

      <PersonActionsSheet
        person={acting && { id: acting.profile.id, name: acting.profile.display_name }}
        onClose={() => setActing(null)}
        // Blocking ends the friendship in the database.
        onBlocked={reload}
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
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    navButton: {
      flex: 1,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      alignItems: 'center',
      gap: spacing.xs,
      position: 'relative',
    },
    unreadDot: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: c.danger,
    },
    navLabel: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    navCaption: {
      ...t.caption,
      fontSize: 12,
      color: c.inkMuted,
    },
  });
