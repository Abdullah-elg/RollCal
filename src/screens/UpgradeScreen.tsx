import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon } from '../components/icons';
import { Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LegalDoc } from '../legal/documents';
import { hapticLight } from '../lib/haptics';
import { PRO_PERKS, PRO_PRICES } from '../lib/pro';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

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
        <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>Thanks for supporting SociaLink.</Text>
        {perks}
      </ScrollView>
    );
  }

  const price = plan === 'yearly' ? PRO_PRICES.yearly : PRO_PRICES.monthly;
  const store = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play account';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={content}>
      <Text style={type.display}>
        {reason === 'scan' ? 'You’ve used this month’s free scans.' : 'Get more out of SociaLink.'}
      </Text>
      <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>
        Pro is {PRO_PRICES.trialDays} days free, then {PRO_PRICES.monthly} a month or{' '}
        {PRO_PRICES.yearly} a year.
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
                      ? `Yearly · ${PRO_PRICES.yearly} a year`
                      : `Monthly · ${PRO_PRICES.monthly} a month`}
                  </Text>
                  {p === 'yearly' && <Text style={type.caption}>Save {PRO_PRICES.yearlySaving}</Text>}
                </View>
                <View style={styles.radio}>{selected && <View style={styles.radioFill} />}</View>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Purchases aren't wired up yet, so the one action stays off. */}
      <Button title="Coming soon" onPress={() => {}} disabled />
      <Text style={[type.caption, styles.note]}>
        Pro isn’t available to buy yet. We’ll let you know in the app when it is.
      </Text>
      <Text style={[type.caption, styles.note]}>
        {PRO_PRICES.trialDays}-day free trial, then {price} a {plan === 'yearly' ? 'year' : 'month'} for
        the plan you picked. Payment is charged to your {store} when you confirm. Your subscription
        renews automatically unless you cancel at least 24 hours before the end of the current
        period. Manage or cancel it any time in your account’s subscription settings.
      </Text>

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
