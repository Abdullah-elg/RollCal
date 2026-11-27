import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ErrorText, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hapticError } from '../lib/haptics';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyEmail'>;

// Supabase won't send another email for 60 seconds anyway.
const RESEND_COOLDOWN = 60;
// The emailed code's length (Supabase's "Email OTP length"). The code is
// checked as soon as this many digits are in, with no button to press.
const CODE_LENGTH = 6;

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
  const shake = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // A wrong code: a quick side-to-side shake (skipped with Reduce Motion),
  // a buzz, and the field cleared for another try.
  const wrongCode = async () => {
    hapticError();
    if (!(await AccessibilityInfo.isReduceMotionEnabled().catch(() => false))) {
      shake.setValue(0);
      Animated.sequence(
        [10, -10, 8, -8, 4, 0].map((toValue) =>
          Animated.timing(shake, {
            toValue,
            duration: 50,
            useNativeDriver: true,
          })
        )
      ).start();
    }
    setCode('');
    inputRef.current?.focus();
  };

  const submit = async (value: string) => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await verifyEmail(email, value);
    setBusy(false);
    // On success the auth listener flips the app to the signed-in stack.
    if (!error) return;
    if (/expired|invalid/i.test(error)) {
      setError('Wrong code. Check the latest email and try again.');
      wrongCode();
    } else {
      setError(error);
    }
  };

  const changeCode = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length > 0 && error) setError(null);
    // Typed, pasted or filled from the email: check it right away.
    if (digits.length === CODE_LENGTH) submit(digits);
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
          We sent a code to <Text style={styles.email}>{email}</Text>. Enter it here to finish
          setting up your account.
        </Text>

        <Animated.View style={{ transform: [{ translateX: shake }] }}>
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={changeCode}
            placeholder="Code"
            placeholderTextColor={colors.inkMuted}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            autoFocus
            style={[styles.codeInput, !code && styles.codeEmpty, error && styles.codeWrong]}
            accessibilityLabel="Verification code"
          />
        </Animated.View>

        {busy ? (
          <View style={styles.checking}>
            <ActivityIndicator size="small" color={colors.inkMuted} />
            <Text style={type.bodyMuted}>Checking…</Text>
          </View>
        ) : null}
        <ErrorText message={error} />
        {notice && !error ? <Text style={styles.notice}>{notice}</Text> : null}

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
      borderRadius: radii.control,
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
    codeWrong: {
      borderColor: c.danger,
    },
    checking: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
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
