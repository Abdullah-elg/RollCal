import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CheckIcon, CloseIcon } from '../components/icons';
import { Button, ErrorText, Field, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: Props) {
  const { signUp } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const { error, needsEmailConfirm } = await signUp(
      email,
      password,
      firstName,
      lastName
    );
    setBusy(false);
    if (error) {
      setError(error);
    } else if (needsEmailConfirm) {
      // Supabase's "Confirm email" setting is on: no session until the link
      // in the email is clicked.
      setAwaitingConfirm(true);
    }
    // Otherwise the auth listener flips straight to the signed-in stack.
  };

  if (awaitingConfirm) {
    return (
      <View style={[styles.screen, styles.confirmWrap]}>
        <Text style={type.h2}>Check your email</Text>
        <Text style={[type.bodyMuted, { marginTop: spacing.sm, marginBottom: spacing.lg }]}>
          We sent a confirmation link to {email.trim()}. Tap it, then come back
          and log in.
        </Text>
        <Button
          title="Back to log in"
          variant="secondary"
          onPress={() => navigation.navigate('SignIn')}
        />
      </View>
    );
  }

  return (
    <FormScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[type.title, { marginBottom: spacing.xs }]}>Create account</Text>
        <Text style={[type.bodyMuted, { marginBottom: spacing.xl }]}>
          Your name is how friends find you.
        </Text>

        <View style={styles.nameRow}>
          <View style={{ flex: 1 }}>
            <Field
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Abdullah"
              autoComplete="given-name"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Elganainy"
              autoComplete="family-name"
            />
          </View>
        </View>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="At least 6 characters"
        />
        <Pressable
          style={styles.termsRow}
          onPress={() => setTermsAccepted((prev) => !prev)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: termsAccepted }}
        >
          <View
            style={[
              styles.checkbox,
              termsAccepted && {
                backgroundColor: colors.accent,
                borderColor: colors.accent,
              },
            ]}
          >
            {termsAccepted && <CheckIcon size={14} color={colors.onAccent} />}
          </View>
          <View style={styles.termsTextWrap}>
            <Text style={type.caption}>
              I agree to the{' '}
              <Text
                style={[styles.termsLink, { color: colors.ink }]}
                onPress={() => setShowTermsModal(true)}
              >
                Terms and Conditions
              </Text>
            </Text>
          </View>
        </Pressable>

        <ErrorText message={error} />
        <Button
          title="Sign up"
          onPress={submit}
          loading={busy}
          disabled={
            !firstName.trim() ||
            !lastName.trim() ||
            !email ||
            password.length < 6 ||
            !termsAccepted
          }
        />

        <View style={styles.switchRow}>
          <Text style={type.bodyMuted}>Already have an account? </Text>
          <Pressable onPress={() => navigation.navigate('SignIn')}>
            <Text style={styles.switchLink}>Log in</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={showTermsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTermsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowTermsModal(false)}
            accessibilityLabel="Close terms dialog"
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={type.h2}>Terms and Conditions</Text>
              <Pressable
                hitSlop={12}
                onPress={() => setShowTermsModal(false)}
                style={styles.closeBtn}
              >
                <CloseIcon size={18} color={colors.ink} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.termsScroll}
              contentContainerStyle={styles.termsScrollContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              bounces
            >
              <Text style={styles.termsSectionTitle}>1. Welcome to SociaLink</Text>
              <Text style={type.body}>
                SociaLink helps you organize private gatherings, coordinate with friends,
                and contribute to shared group photo albums. By creating an account, you agree
                to treat others respectfully and follow these basic terms.
              </Text>

              <Text style={styles.termsSectionTitle}>2. Account and Security</Text>
              <Text style={type.body}>
                You are responsible for keeping your login credentials secure. Please use
                your real name and provide accurate details so your friends can recognize you.
              </Text>

              <Text style={styles.termsSectionTitle}>3. User Content and Photos</Text>
              <Text style={type.body}>
                You own the photos, messages, and content you post. By adding photos to a
                shared event album, you give fellow attendees permission to view and download
                those photos. Do not upload content that violates copyright, privacy, or any laws.
              </Text>

              <Text style={styles.termsSectionTitle}>4. Community Standards</Text>
              <Text style={type.body}>
                Harassment, hate speech, spam, and abusive behavior will result in account
                suspension or removal. Event hosts may remove or ban participants who disrupt events.
              </Text>

              <Text style={styles.termsSectionTitle}>5. Privacy and Location</Text>
              <Text style={type.body}>
                We respect your personal privacy. Location services are only used when you explicitly
                choose to attach a location or pin to an event. We do not sell your personal data.
              </Text>
            </ScrollView>

            <Button
              title="I understand and agree"
              onPress={() => {
                setTermsAccepted(true);
                setShowTermsModal(false);
              }}
            />
          </View>
        </View>
      </Modal>
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
    },
    confirmWrap: {
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    nameRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.md,
      marginBottom: spacing.xs,
      gap: spacing.sm,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: c.line,
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    termsTextWrap: {
      flex: 1,
    },
    termsLink: {
      fontFamily: fonts.bodySemiBold,
      textDecorationLine: 'underline',
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
    modalOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    modalCard: {
      backgroundColor: c.paper,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      padding: spacing.lg,
      height: 480,
      maxHeight: '85%',
      gap: spacing.md,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    closeBtn: {
      padding: spacing.xs,
    },
    termsScroll: {
      flex: 1,
    },
    termsScrollContent: {
      gap: spacing.sm,
      paddingBottom: spacing.md,
    },
    termsSectionTitle: {
      ...t.h3,
      fontFamily: fonts.headingMedium,
      marginTop: spacing.xs,
    },
  });
