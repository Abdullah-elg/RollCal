// Email and password sign-in, with Apple and Google, and the way into sign-up
// and password reset. Signing in switches the app to the signed-in stack.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import SocialSignIn from '../components/SocialSignIn';
import { Button, ErrorText, Field, FormScreen, PasswordField } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export default function SignInScreen({ navigation }: Props) {
  const { signIn } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const { error, needsEmailConfirm } = await signIn(email, password);
    setBusy(false);
    if (error) setError(error);
    else if (needsEmailConfirm) navigation.navigate('VerifyEmail', { email: email.trim() });
    // On success the auth listener flips the app to the signed-in stack.
  };

  return (
    <FormScreen style={styles.screen} safeArea>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.wordmark}>RollCal</Text>
        <Text style={[type.bodyMuted, { marginBottom: spacing.xl }]}>
          Every event ends in one shared roll.
        </Text>

        <SocialSignIn />

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
        />
        <Pressable
          onPress={() => navigation.navigate('ForgotPassword', { email: email.trim() })}
          hitSlop={8}
          style={styles.forgot}
          accessibilityRole="button"
        >
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>
        <ErrorText message={error} />
        <Button
          title="Log in"
          onPress={submit}
          loading={busy}
          disabled={!email || !password}
        />

        <View style={styles.switchRow}>
          <Text style={type.bodyMuted}>New here? </Text>
          <Pressable onPress={() => navigation.navigate('SignUp')}>
            <Text style={styles.switchLink}>Create an account</Text>
          </Pressable>
        </View>
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
    wordmark: {
      ...t.title,
      fontSize: 32,
      marginBottom: spacing.xs,
    },
    forgot: {
      alignSelf: 'flex-end',
      marginTop: -spacing.xs,
      marginBottom: spacing.md,
    },
    forgotText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    switchRow: {
      flexDirection: 'row',
      marginTop: spacing.lg,
    },
    switchLink: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
  });
