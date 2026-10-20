import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon } from '../components/icons';
import { Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LegalDoc } from '../legal/documents';
import { hapticLight } from '../lib/haptics';
import { currencyName, Rates } from '../lib/currency';
import { deviceCurrency, loadRates } from '../lib/fx';
import { PRO_PERKS, PRO_PRICES, proPriceText, PURCHASES_LIVE } from '../lib/pro';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'Upgrade'>;
type Plan = 'yearly' | 'monthly';

const LINKS: { doc: LegalDoc; label: string }[] = [
  { doc: 'terms', label: 'Terms of Service' },
  { doc: 'pro', label: 'Pro Terms' },
  { doc: 'privacy', label: 'Privacy Policy' },
];

export default function UpgradeScreen({ navigation, route }: Props) {
  const { reason } = route.params ?? {};
  const { profile } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<Plan>('yearly');
  // Shown in the person's currency at today's rate; US dollars until the
  // rates load, or if they can't.
  const currency = profile?.currency ?? deviceCurrency();
  const [rates, setRates] = useState<Rates | null>(null);
  useEffect(() => {
    if (currency !== 'USD') loadRates().then(setRates);
  }, [currency]);
  const prices = proPriceText(currency, rates);
  const about = prices.converted ? 'about ' : '';

  const choose = (next: Plan) => {
    if (next === plan) return;
    hapticLight();
    setPlan(next);
  };

  const perks = (
    <View style={styles.perks}>
      {PRO_PERKS.map((perk, i) => (
        <View key={perk.title}>
          {i > 0 && <View style={styles.divider} />}
          <View style={styles.perkRow}>
            <View style={styles.perkIcon}>
              <CheckIcon size={16} color={colors.ink} />
            </View>
            <View style={styles.perkText}>
              <Text style={type.body}>{perk.title}</Text>
              <Text style={type.caption}>{perk.detail}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  const content = { padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg };

  if (profile?.is_pro) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={content}>
        <Text style={type.display}>You’re on Pro.</Text>
        <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>Thanks for supporting RollCal.</Text>
        {perks}
      </ScrollView>
    );
  }

  const headline =
    reason === 'scan'
      ? 'You’ve used this month’s free scan.'
      : reason === 'video'
        ? 'Share videos with Pro.'
        : reason === 'storage'
          ? 'You’ve used this month’s uploads.'
          : reason === 'expiry'
            ? 'Keep your event’s photos.'
            : reason === 'quiet'
              ? 'Turn on Quiet mode.'
              : 'Get more out of RollCal.';

  const price = plan === 'yearly' ? prices.yearly : prices.monthly;
  const store = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play account';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={content}>
      <Text style={type.display}>{headline}</Text>
      <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>
        Pro is {PRO_PRICES.trialDays} days free, then {about}
        {prices.monthly} a month or {prices.yearly} a year.
      </Text>

      {perks}

      <View style={styles.plans}>
        {(['yearly', 'monthly'] as const).map((p, i) => {
          const selected = plan === p;
          return (
            <View key={p}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => choose(p)}
                style={({ pressed }) => [styles.planRow, pressed && { opacity: 0.6 }]}
              >
                <View style={styles.perkText}>
                  <Text style={type.body}>
                    {p === 'yearly'
                      ? `Yearly · ${about}${prices.yearly} a year`
                      : `Monthly · ${about}${prices.monthly} a month`}
                  </Text>
                  {p === 'yearly' && <Text style={type.caption}>Save {PRO_PRICES.yearlySaving}</Text>}
                </View>
                <View style={styles.radio}>{selected && <View style={styles.radioFill} />}</View>
              </Pressable>
            </View>
          );
        })}
      </View>

      {PURCHASES_LIVE ? null : (
        // Nothing to buy yet: say so plainly and offer a way in, rather than a
        // button that does nothing.
        <View style={styles.beta}>
          <Text style={type.h3}>Pro is free during the beta</Text>
          <Text style={[type.bodyMuted, { marginTop: spacing.xs }]}>
            Want to try it? Ask us and we’ll switch it on for your account.
          </Text>
          <Button
            title="Ask for Pro"
            variant="secondary"
            onPress={() => navigation.navigate('Support')}
            style={{ marginTop: spacing.md }}
          />
        </View>
      )}
      {prices.converted && (
        <Text style={[type.caption, styles.note]}>
          Pro is priced in US dollars ({prices.usd.monthly} a month or {prices.usd.yearly} a year).
          Prices here are converted to {currency} ({currencyName(currency)}) at today’s exchange
          rate, as a guide.
          {PURCHASES_LIVE &&
            ` You’re charged in your ${store}’s currency, at the price shown before you confirm.`}
        </Text>
      )}
      {PURCHASES_LIVE && (
        <Text style={[type.caption, styles.note]}>
          {PRO_PRICES.trialDays}-day free trial, then {about}{price} a{' '}
          {plan === 'yearly' ? 'year' : 'month'} for the plan you picked. Payment is charged to your{' '}
          {store} when you confirm. Your subscription renews automatically unless you cancel at least
          24 hours before the end of the current period. Manage or cancel it any time in your
          account’s subscription settings.
        </Text>
      )}

      <View style={styles.links}>
        {LINKS.map(({ doc, label }, i) => (
          <View key={doc} style={styles.linkItem}>
            {i > 0 && <Text style={type.caption}> · </Text>}
            <Pressable
              accessibilityRole="link"
              hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
              onPress={() => navigation.navigate('Legal', { doc })}
            >
              <Text style={styles.link}>{label}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    perks: { marginTop: spacing.lg, marginBottom: spacing.lg },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
    perkRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    perkIcon: { height: 22, justifyContent: 'center' },
    perkText: { flex: 1, gap: 2 },
    plans: {
      marginBottom: spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    planRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 56,
      paddingVertical: spacing.sm,
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: c.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioFill: { width: 20, height: 20, borderRadius: 10, backgroundColor: c.ink, margin: -1.5 },
    note: { marginTop: spacing.md },
    beta: {
      backgroundColor: c.card,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      padding: spacing.lg,
    },
    links: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xl,
    },
    linkItem: { flexDirection: 'row', alignItems: 'center' },
    link: { ...t.caption, fontFamily: fonts.bodySemiBold, color: c.ink },
  });
