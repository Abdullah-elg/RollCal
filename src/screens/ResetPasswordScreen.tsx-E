import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, ErrorText, FormScreen, PasswordField } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

// Supabase won't send another email for 60 seconds anyway.
const RESEND_COOLDOWN = 60;
// Matches sign-up.
const MIN_PASSWORD = 6;

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

// Step two of a password reset: the emailed code and the new password,
// together, so a correct code never leaves someone signed in without one.
export default function ResetPasswordScreen({ navigation, route }: Props) {
  const { email } = route.params;
  const { resetPassword, sendPasswordReset } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await resetPassword(email, code, password);
    setBusy(false);
    // On success the app moves on to the signed-in screens.
    if (error) setError(friendlyError(error));
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    const { error } = await sendPasswordReset(email);
    if (error) {
      setError(error);
    } else {
      setNotice('New code sent.');
      setCode('');
      setCooldown(RESEND_COOLDOWN);
    }
  };

  return (
    <FormScreen style={styles.screen} safeArea>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[type.title, { marginBottom: spacing.xs }]}>Choose a new password</Text>
        <Text style={[type.bodyMuted, { marginBottom: spacing.xl }]}>
          If <Text style={styles.email}>{email}</Text> has a RollCal account, we’ve sent it a
          code. Enter it below with your new password.
        </Text>

        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
          placeholder="Code"
          placeholderTextColor={colors.inkMuted}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={8}
          autoFocus
          style={[styles.codeInput, !code && styles.codeEmpty]}
          accessibilityLabel="Reset code"
        />
        <PasswordField
          label="New password"
          value={password}
          onChangeText={setPassword}
          textContentType="newPassword"
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
        />

        <ErrorText message={error} />
        {notice && !error ? <Text style={styles.notice}>{notice}</Text> : null}

        <Button
          title="Save new password"
          onPress={submit}
          loading={busy}
          disabled={code.length < 6 || password.length < MIN_PASSWORD}
        />

        <View style={styles.row}>
          <Text style={type.bodyMuted}>No email? </Text>
          {cooldown > 0 ? (
            <Text style={type.bodyMuted}>Resend in {cooldown}s</Text>
          ) : (
            <Pressable onPress={resend} hitSlop={8}>
              <Text style={styles.link}>Send a new code</Text>
            </Pressable>
          )}
        </View>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.back}>
          <Text style={styles.link}>Use a different email</Text>
        </Pressable>
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
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
    },
    email: {
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    codeInput: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 28,
      letterSpacing: 8,
      color: c.ink,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.sm,
      // Same as the code field on VerifyEmailScreen: a fixed height with no
      // vertical padding, or iOS clips the tops of these large digits.
      height: 64,
      paddingHorizontal: spacing.md,
      textAlignVertical: 'center',
      marginBottom: spacing.md,
    },
    // The placeholder in the normal field style, so the letter spacing
    // doesn't push "Code" under the cursor.
    codeEmpty: {
      fontFamily: fonts.body,
      fontSize: 15,
      letterSpacing: 0,
    },
    notice: {
      ...t.caption,
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row',
      marginTop: spacing.lg,
    },
    back: {
      marginTop: spacing.sm,
      alignSelf: 'flex-start',
    },
    link: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
  });
