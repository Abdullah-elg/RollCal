// Friend requests the user has sent that nobody has answered yet, with a
// way to cancel them.

import { useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { SendIcon } from '../components/icons';
import { PersonList, PersonRow, RowAction } from '../components/PersonRow';
import { PageIntro } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { useFriendData } from '../hooks/useFriendData';
import { removeFriendship } from '../lib/friends';
import { hapticLight } from '../lib/haptics';
import { Palette, spacing, TypeTokens } from '../theme';

// Requests I've sent that nobody has answered yet.
export default function SentRequestsScreen() {
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
      <PageIntro icon={SendIcon}>
        {data.outgoing.length > 0
          ? `${data.outgoing.length} waiting on a reply`
          : 'Nothing pending'}
      </PageIntro>

      {!loaded ? (
        <ActivityIndicator color={colors.accent} />
      ) : data.outgoing.length === 0 ? (
        <Text style={[type.bodyMuted, { paddingVertical: spacing.md }]}>
          Nothing pending. Requests you send sit here until they're answered.
        </Text>
      ) : (
        <PersonList>
          {data.outgoing.map((link) => (
            <PersonRow key={link.friendshipId} person={link.profile}>
              <RowAction
                label="Cancel"
                tone="muted"
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
