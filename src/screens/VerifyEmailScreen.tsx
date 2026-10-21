import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, ErrorText, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyEmail'>;

// Supabase won't send another email for 60 seconds anyway.
const RESEND_COOLDOWN = 60;

export default function VerifyEmailScreen({ navigation, route }: Props) {
  const { email } = route.params;
  const { verifyEmail, resendEmailCode } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [code, setCode] = useState('');
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
    setBusy(true);
    const { error } = await verifyEmail(email, code);
    setBusy(false);
    // On success the auth listener flips the app to the signed-in stack.
    if (error) setError(error);
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    const { error } = await resendEmailCode(email);
    if (error) {
      setError(error);
    } else {
      setNotice('New code sent.');
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
        <Text style={[type.title, { marginBottom: spacing.xs }]}>Check your email</Text>
        <Text style={[type.bodyMuted, { marginBottom: spacing.xl }]}>
          We sent a code to <Text style={styles.email}>{email}</Text>. Enter it here to
          finish setting up your account.
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
          accessibilityLabel="Verification code"
        />

        <ErrorText message={error} />
        {notice && !error ? <Text style={styles.notice}>{notice}</Text> : null}

        <Button title="Verify" onPress={submit} loading={busy} disabled={code.length < 6} />

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
      // A fixed height with no vertical padding, like the other fields: with
      // padding, iOS sizes a single-line input to the font's line and clips
      // the tops of these large digits.
      height: 64,
      paddingHorizontal: spacing.md,
      textAlignVertical: 'center',
      marginBottom: spacing.md,
    },
    // The placeholder in the normal field style: the big, spaced-out digits
    // are only for the code itself, and the spacing would push "Code" under
    // the cursor.
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
