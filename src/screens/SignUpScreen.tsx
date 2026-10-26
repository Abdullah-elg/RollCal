// The sign-up form. Checks the username is free, asks for a birth date for
// the age check, and defaults the currency to the phone's region. If email
// confirmation is on, it goes on to enter the emailed code.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
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
import BirthDateFields from '../components/BirthDateFields';
import CurrencyPicker from '../components/CurrencyPicker';
import {
  Button,
  ErrorText,
  Field,
  FormScreen,
  PasswordField,
  SelectField,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LEGAL, LegalDoc } from '../legal/documents';
import { checkAge } from '../lib/age';
import { isReservedEmail, RESERVED_EMAIL_ERROR } from '../lib/reservedEmails';
import { currencyLabel } from '../lib/currency';
import { deviceCurrency } from '../lib/fx';
import { cleanUsername, USERNAME_MAX, usernameProblem } from '../lib/username';
import { isUsernameAvailable } from '../lib/usernameCheck';
import { AuthStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';
import { NAME_MAX } from '../lib/limits';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: Props) {
  const { signUp, blockForAge } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  // The last answer from the server, and which name it was for.
  const [availability, setAvailability] = useState<{ name: string; free: boolean | null } | null>(
    null
  );
  // Starts on the phone's region; bills and Pro prices are shown in it.
  const [currency, setCurrency] = useState(deviceCurrency);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [birthYear, setBirthYear] = useState('');
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordsMatch = confirmPassword === password;
  // Only once they've finished typing the second one (left the box, or typed
  // as many characters as the first), so it doesn't flag every keystroke.
  const showMismatch =
    !passwordsMatch &&
    confirmPassword.length > 0 &&
    (confirmTouched || confirmPassword.length >= password.length);

  const chosen = cleanUsername(username);
  const problem = chosen ? usernameProblem(chosen) : null;
  // undefined while the check for this exact name is still on its way.
  const free = availability?.name === chosen ? availability.free : undefined;

  // Ask whether the name is free once typing pauses.
  useEffect(() => {
    if (!chosen || problem) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const result = await isUsernameAvailable(chosen);
      if (!cancelled) setAvailability({ name: chosen, free: result });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [chosen, problem]);

  const usernameStatus: { text: string; tone: 'muted' | 'good' | 'bad' } = !chosen
    ? { text: 'How friends find you on RollCal.', tone: 'muted' }
    : problem
      ? { text: problem, tone: 'bad' }
      : free === undefined
        ? { text: 'Checking…', tone: 'muted' }
        : free === false
          ? { text: 'That username is taken.', tone: 'bad' }
          : free
            ? { text: `@${chosen} is yours if you want it.`, tone: 'good' }
            : { text: 'How friends find you on RollCal.', tone: 'muted' };

  const ageResult = birthYear.length === 4 ? checkAge(Number(birthYear), birthMonth) : 'invalid';
  const ageAnswered = ageResult === 'ok' || ageResult === 'too_young';

  const submit = async () => {
    setError(null);
    // Checked only on submit, so the form doesn't hint at the cut-off.
    if (ageResult === 'too_young') {
      await blockForAge();
      return;
    }
    if (ageResult !== 'ok') return;
    if (!passwordsMatch) {
      setConfirmTouched(true);
      return;
    }
    if (isReservedEmail(email)) {
      setError(RESERVED_EMAIL_ERROR);
      return;
    }
    setBusy(true);
    const { error, needsEmailConfirm } = await signUp(
      email,
      password,
      firstName,
      lastName,
      chosen,
      currency
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
    <FormScreen style={styles.screen} safeArea>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[type.title, { marginBottom: spacing.xl }]}>Create account</Text>

        <SocialSignIn onShowLegal={setLegalDoc} />

        <View style={styles.nameRow}>
          <View style={{ flex: 1 }}>
            <Field
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Sam"
              autoComplete="given-name"
              maxLength={NAME_MAX}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Rivera"
              autoComplete="family-name"
              maxLength={NAME_MAX}
            />
          </View>
        </View>
        <Field
          label="Username"
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase())}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={USERNAME_MAX + 1}
          placeholder="samrivera"
        />
        <Text
          style={[
            styles.usernameStatus,
            usernameStatus.tone === 'good' && { color: colors.accentText },
            usernameStatus.tone === 'bad' && { color: colors.danger },
          ]}
        >
          {usernameStatus.text}
        </Text>
        <BirthDateFields
          year={birthYear}
          onYear={(v) => {
            setBirthYear(v);
            setBirthMonth(null);
          }}
          month={birthMonth}
          onMonth={setBirthMonth}
          askMonth={birthYear.length === 4 && checkAge(Number(birthYear), null) === 'need_month'}
        />
        {birthYear.length === 4 && ageResult === 'invalid' && checkAge(Number(birthYear), null) === 'invalid' ? (
          <Text style={[type.caption, { color: colors.danger, marginTop: -spacing.sm, marginBottom: spacing.md }]}>
            Enter the four-digit year you were born.
          </Text>
        ) : null}
        <SelectField
          label="Currency"
          value={currencyLabel(currency)}
          onPress={() => setPickingCurrency(true)}
          accessibilityHint="Bills you split and Pro prices are shown in it"
        />
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
          placeholder="At least 6 characters"
        />
        <PasswordField
          label="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          onBlur={() => setConfirmTouched(true)}
          placeholder="Type it again"
        />
        {showMismatch && <Text style={styles.passwordMismatch}>Passwords don’t match.</Text>}
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
            !ageAnswered ||
            !chosen ||
            !!problem ||
            free === undefined ||
            free === false ||
            !email ||
            password.length < 6 ||
            !passwordsMatch ||
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

      <CurrencyPicker
        visible={pickingCurrency}
        selected={currency}
        intro="Bills you split and Pro prices are shown in it. You can change it later in Settings."
        onSelect={(code) => {
          setCurrency(code);
          setPickingCurrency(false);
        }}
        onClose={() => setPickingCurrency(false)}
      />

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
      paddingVertical: spacing.lg,
    },
    nameRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    passwordMismatch: {
      ...t.caption,
      color: c.danger,
      marginTop: -spacing.sm,
      marginBottom: spacing.md,
    },
    usernameStatus: {
      ...t.caption,
      marginTop: -spacing.sm,
      marginBottom: spacing.md,
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
