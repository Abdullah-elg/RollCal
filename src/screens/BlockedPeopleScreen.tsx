import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import ConfirmDialog from '../components/ConfirmDialog';
import { PersonList, PersonRow, RowAction } from '../components/PersonRow';
import { ErrorText } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { animateNext } from '../lib/animate';
import { hapticLight } from '../lib/haptics';
import { loadBlockedPeople, unblockUser } from '../lib/safety';
import { Palette, spacing } from '../theme';
import { Profile } from '../types';

export default function BlockedPeopleScreen() {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [unblocking, setUnblocking] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadBlockedPeople().then(setPeople);
    }, [])
  );

  const unblock = async (person: Profile) => {
    const err = await unblockUser(person.id);
    if (err) {
      setError(err);
      return;
    }
    hapticLight();
    setError(null);
    animateNext();
    setPeople((prev) => prev && prev.filter((p) => p.id !== person.id));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ErrorText message={error} />
      {people === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : people.length === 0 ? (
        <Text style={type.bodyMuted}>You haven’t blocked anyone.</Text>
      ) : (
        <PersonList>
          {people.map((person) => (
            <PersonRow key={person.id} person={person}>
              <RowAction label="Unblock" onPress={() => setUnblocking(person)} />
            </PersonRow>
          ))}
        </PersonList>
      )}

      <ConfirmDialog
        visible={unblocking !== null}
        title={`Unblock ${unblocking?.display_name ?? ''}?`}
        message="They’ll be able to find and add you again."
        confirmLabel="Unblock"
        onConfirm={() => {
          const person = unblocking;
          setUnblocking(null);
          if (person) unblock(person);
        }}
        onCancel={() => setUnblocking(null)}
      />
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  });
