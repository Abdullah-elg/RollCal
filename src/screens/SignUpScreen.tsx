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
import LegalText from '../components/LegalText';
import SocialSignIn from '../components/SocialSignIn';
import { Button, ErrorText, Field, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LEGAL, LegalDoc } from '../legal/documents';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

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
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      // Supabase's "Confirm email" setting is on: no session until the
      // code from the email is entered.
      navigation.navigate('VerifyEmail', { email: email.trim() });
    }
    // Otherwise the auth listener flips straight to the signed-in stack.
  };

  return (
    <FormScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[type.title, { marginBottom: spacing.xl }]}>Create account</Text>

        <SocialSignIn onShowTerms={() => setLegalDoc('terms')} />

        <View style={styles.nameRow}>
          <View style={{ flex: 1 }}>
            <Field
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Sam"
              autoComplete="given-name"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Rivera"
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
                onPress={() => setLegalDoc('terms')}
              >
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text
                style={[styles.termsLink, { color: colors.ink }]}
                onPress={() => setLegalDoc('privacy')}
              >
                Privacy Policy
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
        visible={legalDoc !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLegalDoc(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setLegalDoc(null)}
            accessibilityLabel="Close"
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={type.h2}>{legalDoc ? LEGAL[legalDoc].title : ''}</Text>
              <Pressable
                hitSlop={12}
                onPress={() => setLegalDoc(null)}
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
              {legalDoc && <LegalText doc={legalDoc} />}
            </ScrollView>

            <Button
              title="I understand and agree"
              onPress={() => {
                setTermsAccepted(true);
                setLegalDoc(null);
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
    nameRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.xs,
      marginBottom: spacing.md,
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
      paddingBottom: spacing.md,
    },
  });
