// Change the password from Edit profile. With the current password it's
// one step; without it (forgotten, or the account signs in with Apple or
// Google and has none yet) a code is emailed first, the same as a reset.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorText, Field, FormScreen, PasswordField } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hapticSuccess } from '../lib/haptics';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'ChangePassword'>;

// Matches sign-up and the reset screen.
const MIN_PASSWORD = 6;
// Supabase won't send another email for 60 seconds anyway.
const RESEND_COOLDOWN = 60;

// Supabase's wording, in the app's voice.
function friendlyError(message: string): string {
  if (/expired|invalid/i.test(message)) {
    return 'That code is wrong or has expired. Check the latest email, or send a new code.';
  }
  if (/different from the old/i.test(message)) {
    return 'Choose a password you haven’t used for this account before.';
  }
  return message;
}

export default function ChangePasswordScreen({ navigation }: Props) {
  const { session, changePassword, setPasswordWithCode, sendPasswordReset } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const email = session?.user.email ?? '';
  // Accounts made with Apple or Google have no password to type in.
  const providers = (session?.user.app_metadata?.providers as string[] | undefined) ?? [];
  const hasPassword = providers.includes('email');

  // 'current': old + new password. 'code': emailed code + new password.
  const [mode, setMode] = useState<'current' | 'code'>(hasPassword ? 'current' : 'code');
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await sendPasswordReset(email);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setMode('code');
    setCodeSent(true);
    setCode('');
    setNotice(`We sent a code to ${email}.`);
    setCooldown(RESEND_COOLDOWN);
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } =
      mode === 'current' ? await changePassword(current, next) : await setPasswordWithCode(code, next);
    setBusy(false);
    if (error) {
      setError(friendlyError(error));
      return;
    }
    hapticSuccess();
    navigation.goBack();
  };

  if (!email) {
    return (
      <FormScreen style={styles.screen}>
        <View style={styles.content}>
          <Text style={type.bodyMuted}>This account has no email address, so it has no password.</Text>
        </View>
      </FormScreen>
    );
  }

  return (
    <FormScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {mode === 'current' ? (
          <>
            <PasswordField
              label="Current password"
              value={current}
              onChangeText={setCurrent}
              textContentType="password"
              autoComplete="current-password"
              autoFocus
            />
            <PasswordField
              label="New password"
              value={next}
              onChangeText={setNext}
              textContentType="newPassword"
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD} characters`}
            />
            <ErrorText message={error} />
            <Button
              title="Save new password"
              onPress={save}
              loading={busy}
              disabled={!current || next.length < MIN_PASSWORD}
            />
            <Pressable onPress={sendCode} hitSlop={8} style={styles.link} disabled={busy}>
              <Text style={styles.linkText}>Forgot your current password?</Text>
            </Pressable>
          </>
        ) : !codeSent ? (
          <>
            <Text style={[type.bodyMuted, styles.intro]}>
              {hasPassword
                ? 'We’ll email a code to '
                : 'You sign in with Apple or Google, so there’s no password yet. To add one, we’ll email a code to '}
              <Text style={styles.email}>{email}</Text>.
            </Text>
            <ErrorText message={error} />
            <Button title="Email me a code" onPress={sendCode} loading={busy} />
          </>
        ) : (
          <>
            {notice && !error ? (
              <Text style={[type.bodyMuted, styles.intro]}>{notice}</Text>
            ) : null}
            <Field
              label="Code from the email"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={8}
              autoFocus
            />
            <PasswordField
              label="New password"
              value={next}
              onChangeText={setNext}
              textContentType="newPassword"
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD} characters`}
            />
            <ErrorText message={error} />
            <Button
              title="Save new password"
              onPress={save}
              loading={busy}
              disabled={code.length < 6 || next.length < MIN_PASSWORD}
            />
            <View style={styles.row}>
              <Text style={type.bodyMuted}>No email? </Text>
              {cooldown > 0 ? (
                <Text style={type.bodyMuted}>Resend in {cooldown}s</Text>
              ) : (
                <Pressable onPress={sendCode} hitSlop={8}>
                  <Text style={styles.linkText}>Send a new code</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </FormScreen>
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
    },
    intro: {
      marginBottom: spacing.lg,
    },
    email: {
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    row: {
      flexDirection: 'row',
      marginTop: spacing.lg,
    },
    link: {
      marginTop: spacing.lg,
      alignSelf: 'flex-start',
    },
    linkText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
  });
