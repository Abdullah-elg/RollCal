// Search for people by name or username and send friend requests. Shows
// whether someone is already a friend or has a request pending, and leaves
// out people who are blocked.

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SearchIcon } from '../components/icons';
import PersonActionsSheet from '../components/PersonActionsSheet';
import {
  MoreAction,
  PersonList,
  PersonRow,
  RowAction,
  RowTag,
} from '../components/PersonRow';
import { Field, PageIntro } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { useFriendData } from '../hooks/useFriendData';
import { animateNext } from '../lib/animate';
import { hapticLight } from '../lib/haptics';
import {
  acceptFriendRequest,
  searchProfiles,
  sendFriendRequest,
} from '../lib/friends';
import { loadHiddenPeople } from '../lib/safety';
import { Palette, radii, spacing, TypeTokens } from '../theme';
import { Profile } from '../types';

export default function FindPeopleScreen() {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const { userId, data, reload } = useFriendData();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<Profile | null>(null);

  const runSearch = async () => {
    Keyboard.dismiss();
    setNotice(null);
    setSearching(true);
    const hidden = await loadHiddenPeople();
    const found = await searchProfiles(query, userId, hidden);
    animateNext();
    setResults(found);
    setSearching(false);
  };

  const request = async (target: Profile) => {
    hapticLight();
    const res = await sendFriendRequest(target.id);
    const name = target.first_name ?? target.display_name;
    setNotice(
      'error' in res
        ? res.error
        : res.result === 'friends'
          ? 'You’re now friends.'
          : `Request sent to ${name}.`
    );
    reload();
  };

  // What's already between me and this person?
  const relationOf = (id: string) => {
    if (data.friends.some((l) => l.profile.id === id)) return 'friend' as const;
    if (data.incoming.some((l) => l.profile.id === id)) return 'incoming' as const;
    if (data.outgoing.some((l) => l.profile.id === id)) return 'outgoing' as const;
    return null;
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <PageIntro icon={SearchIcon}>
        Find someone by name or @username
      </PageIntro>

      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <Field
            label="Search"
            value={query}
            onChangeText={setQuery}
            placeholder="Name or @username"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={runSearch}
          />
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.searchButton,
            query.trim().length < 2 && { opacity: 0.5 },
            pressed && { opacity: 0.8 },
          ]}
          onPress={runSearch}
          disabled={query.trim().length < 2}
        >
          <Text style={styles.searchButtonText}>Search</Text>
        </Pressable>
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {searching && <ActivityIndicator color={colors.accent} />}

      {results !== null && !searching && (
        results.length === 0 ? (
          <Text style={[type.bodyMuted, { paddingVertical: spacing.md }]}>
            No one found. Try their exact @username, or check the spelling.
          </Text>
        ) : (
          <PersonList>
            {results.map((person) => {
              const relation = relationOf(person.id);
              const link = [...data.incoming].find((l) => l.profile.id === person.id);
              return (
                <PersonRow key={person.id} person={person}>
                  {relation === 'friend' && <RowTag label="Friends" />}
                  {relation === 'outgoing' && <RowTag label="Requested" />}
                  {relation === 'incoming' && link && (
                    <RowAction
                      label="Accept"
                      onPress={async () => {
                        hapticLight();
                        await acceptFriendRequest(link.friendshipId);
                        reload();
                      }}
                    />
                  )}
                  {relation === null && (
                    <RowAction label="Add" onPress={() => request(person)} />
                  )}
                  <MoreAction name={person.display_name} onPress={() => setActing(person)} />
                </PersonRow>
              );
            })}
          </PersonList>
        )
      )}

      <PersonActionsSheet
        person={acting && { id: acting.id, name: acting.display_name }}
        onClose={() => setActing(null)}
        onBlocked={() => {
          const id = acting?.id;
          animateNext();
          setResults((prev) => prev && prev.filter((p) => p.id !== id));
          reload();
        }}
      />
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
    searchRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
    },
    // The one action on this page, so it takes the filled accent.
    searchButton: {
      height: 48,
      marginBottom: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.control,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchButtonText: {
      ...t.button,
      color: c.onAccent,
    },
    notice: {
      ...t.caption,
      color: c.ink,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
  });
