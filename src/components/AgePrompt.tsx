import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { checkAge } from '../lib/age';
import { Palette, spacing, TypeTokens } from '../theme';
import BirthDateFields from './BirthDateFields';
import { Button, ErrorText } from './ui';

// Asks once for a birth date from anyone who hasn't passed the age check:
// Apple and Google sign-ins (which skip the sign-up form) and accounts made
// before it existed. Nothing is stored except that they passed. Shown in
// place of the app (see needsAgeCheck) until it's answered.
export const needsAgeCheck = (meta: Record<string, unknown> | undefined) =>
  meta?.age_confirmed !== true;

export default function AgePrompt() {
  const { session, confirmAge, refuseUnderAge } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [year, setYear] = useState('');
  const [month, setMonth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session || !needsAgeCheck(session.user.user_metadata)) return null;

  const result = year.length === 4 ? checkAge(Number(year), month) : 'invalid';
  const answered = result === 'ok' || result === 'too_young';

  const submit = async () => {
    setError(null);
    setBusy(true);
    if (result === 'too_young') {
      await refuseUnderAge();
      return;
    }
    const { error } = await confirmAge();
    setBusy(false);
    if (error) setError(error);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={type.title}>One quick thing</Text>
        <Text style={[type.bodyMuted, { marginTop: spacing.sm, marginBottom: spacing.xl }]}>
          When were you born? We don’t keep your birth date.
        </Text>
        <BirthDateFields
          year={year}
          onYear={(v) => {
            setYear(v);
            setMonth(null);
          }}
          month={month}
          onMonth={setMonth}
          askMonth={year.length === 4 && checkAge(Number(year), null) === 'need_month'}
        />
        <ErrorText message={error} />
        <Button title="Continue" onPress={submit} loading={busy} disabled={!answered} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, _t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  });
