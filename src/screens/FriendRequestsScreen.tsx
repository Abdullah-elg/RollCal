// Friend requests other people have sent the user, to accept or decline.

import { useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { InboxIcon } from '../components/icons';
import { PersonList, PersonRow, RowAction } from '../components/PersonRow';
import { PageIntro } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { useFriendData } from '../hooks/useFriendData';
import { acceptFriendRequest, removeFriendship } from '../lib/friends';
import { hapticLight } from '../lib/haptics';
import { Palette, spacing, TypeTokens } from '../theme';

// Requests waiting on me.
export default function FriendRequestsScreen() {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const { data, loaded, refreshing, refresh, reload } = useFriendData();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
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
      <PageIntro icon={InboxIcon}>
        {data.incoming.length > 0
          ? `${data.incoming.length} ${
              data.incoming.length === 1 ? 'person wants' : 'people want'
            } to be friends`
          : 'Nothing waiting'}
      </PageIntro>

      {!loaded ? (
        <ActivityIndicator color={colors.accent} />
      ) : data.incoming.length === 0 ? (
        <Text style={[type.bodyMuted, { paddingVertical: spacing.md }]}>
          No requests right now. When someone adds you, they'll show up here.
        </Text>
      ) : (
        <PersonList>
          {data.incoming.map((link) => (
            <PersonRow key={link.friendshipId} person={link.profile}>
              <RowAction
                label="Accept"
                onPress={async () => {
                  hapticLight();
                  await acceptFriendRequest(link.friendshipId);
                  reload();
                }}
              />
              <RowAction
                label="Decline"
                tone="danger"
                onPress={async () => {
                  hapticLight();
                  await removeFriendship(link.friendshipId);
                  reload();
                }}
              />
            </PersonRow>
          ))}
        </PersonList>
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
  });
