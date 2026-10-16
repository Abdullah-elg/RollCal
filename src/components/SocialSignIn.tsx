import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { isAppleSignInAvailable } from '../lib/socialAuth';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { ErrorText } from './ui';

// "Continue with Apple" (iOS only) and "Continue with Google", above an
// "or" divider that leads into the email form below. On sign-up, pass
// onShowTerms: these buttons skip the form's terms checkbox, so they carry
// their own notice instead.
export default function SocialSignIn({ onShowTerms }: { onShowTerms?: () => void }) {
  const { signInWithApple, signInWithGoogle } = useAuth();
  const { colors, type, mode } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const apple = async () => {
    setError(null);
    const { error } = await signInWithApple();
    if (error) setError(error);
  };

  const google = async () => {
    setError(null);
    setGoogleBusy(true);
    const { error } = await signInWithGoogle();
    setGoogleBusy(false);
    if (error) setError(error);
  };

  return (
    <View>
      {appleAvailable && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            mode === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={radii.sm}
          style={styles.apple}
          onPress={apple}
        />
      )}

      <Pressable
        onPress={google}
        disabled={googleBusy}
        style={({ pressed }) => [styles.google, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
      >
        {googleBusy ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <>
            <GoogleLogo />
            <Text style={styles.googleText}>Continue with Google</Text>
          </>
        )}
      </Pressable>

      {onShowTerms && (
        <Text style={styles.terms}>
          By continuing with Apple or Google you agree to the{' '}
          <Text style={styles.termsLink} onPress={onShowTerms}>
            Terms and Conditions
          </Text>
          .
        </Text>
      )}

      <ErrorText message={error} />

      <View style={styles.divider}>
        <View style={styles.rule} />
        <Text style={type.caption}>or with email</Text>
        <View style={styles.rule} />
      </View>
    </View>
  );
}

// Google's brand guidelines require their full-colour "G".
function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    apple: {
      height: 48,
      width: '100%',
      marginBottom: spacing.sm,
    },
    google: {
      height: 48,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.card,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    googleText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    terms: {
      ...t.caption,
      marginTop: -spacing.xs,
      marginBottom: spacing.md,
    },
    termsLink: {
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      textDecorationLine: 'underline',
    },
    divider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
    },
  });
