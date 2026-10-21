import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, ErrorText, Field, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

// Step one of a password reset: where to send the code.
export default function ForgotPasswordScreen({ navigation, route }: Props) {
  const { sendPasswordReset } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [email, setEmail] = useState(route.params?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const { error } = await sendPasswordReset(email);
    setBusy(false);
    if (error) setError(error);
    else navigation.navigate('ResetPassword', { email: email.trim() });
  };

  return (
    <FormScreen style={styles.screen} safeArea>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[type.title, { marginBottom: spacing.xs }]}>Forgot password</Text>
        <Text style={[type.bodyMuted, { marginBottom: spacing.xl }]}>
          Enter the email you signed up with and we’ll send you a code to choose a new
          password.
        </Text>

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          autoFocus
        />
        <ErrorText message={error} />
        <Button title="Send code" onPress={submit} loading={busy} disabled={!email.includes('@')} />

        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.back}>
          <Text style={styles.link}>Back to log in</Text>
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
    back: {
      marginTop: spacing.lg,
      alignSelf: 'flex-start',
    },
    link: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
  });
