// The Plans screen: a swipeable pager of Free, Plus, Pro and Event Pass cards
// that all list the same rows (PLAN_COMPARISON), so swiping compares plans.
// Prices show in the person's currency. While PURCHASES_LIVE is off nobody
// can buy: paid cards say it's free in the beta and offer to ask for it.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon } from '../components/icons';
import RatesCredit from '../components/RatesCredit';
import { Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LegalDoc } from '../legal/documents';
import { currencyName, Rates } from '../lib/currency';
import { deviceCurrency, loadRates } from '../lib/fx';
import { hapticLight } from '../lib/haptics';
import { yearlySavingPercent } from '../lib/planPrices';
import {
  Billing,
  PLAN_COMPARISON,
  isPass,
  PASS_BLURBS,
  PLAN_GROUP_BLURBS,
  PLAN_GROUP_NAMES,
  PLAN_GROUPS,
  PlanGroup,
  PLAN_NAMES,
  PLAN_PRICES,
  PlanId,
  planOf,
  priceText,
  PURCHASES_LIVE,
  UpgradeReason,
} from '../lib/pro';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'Upgrade'>;

const LINKS: { doc: LegalDoc; label: string }[] = [
  { doc: 'terms', label: 'Terms of Service' },
  { doc: 'pro', label: 'Pro Terms' },
  { doc: 'privacy', label: 'Privacy Policy' },
];

// How much of the next card shows at the right edge, and the gap between cards.
const PEEK = 24;
const GAP = spacing.sm;

// Which card opens first: the one that fixes what they just ran into.
function startingPlan(reason: UpgradeReason | undefined, current: PlanId): PlanId {
  if (reason === 'people') return current === 'plus' || current === 'pro' ? 'bigday' : 'party';
  if (reason === 'photos' || reason === 'expiry') return current === 'free' ? 'party' : 'bigday';
  return 'plus';
}

export default function UpgradeScreen({ navigation, route }: Props) {
  const { reason, plan: planParam, eventId } = route.params ?? {};
  const { profile } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const current: PlanId = planOf(profile);
  // Two groups: a subscription that covers every event you host, or a pass
  // for one event. Pro isn't on the screen any more; someone on it starts
  // at Plus.
  const start = planParam ?? startingPlan(reason, current);
  const [group, setGroup] = useState<PlanGroup>(isPass(start) ? 'one' : 'every');
  const ids = PLAN_GROUPS[group];
  const firstIndex = Math.max(0, PLAN_GROUPS[isPass(start) ? 'one' : 'every'].indexOf(start));
  const [index, setIndex] = useState(firstIndex);
  const switchGroup = (g: PlanGroup) => {
    if (g === group) return;
    hapticLight();
    setGroup(g);
    setIndex(0);
  };
  const [billing, setBilling] = useState<Billing>('yearly');
  const listRef = useRef<FlatList<PlanId>>(null);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  // Shown in the person's currency at today's rate; US dollars until the
  // rates load, or if they can't.
  const currency = profile?.currency ?? deviceCurrency();
  const [rates, setRates] = useState<Rates | null>(null);
  useEffect(() => {
    if (currency !== 'USD') loadRates().then(setRates);
  }, [currency]);

  // The event an Event Pass is for, so the ask can name it.
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!eventId) return;
    supabase
      .from('events')
      .select('title')
      .eq('id', eventId)
      .maybeSingle()
      .then(({ data }) => setEventTitle((data as { title?: string } | null)?.title ?? null));
  }, [eventId]);

  const cardWidth = width - spacing.lg - GAP - PEEK;
  const interval = cardWidth + GAP;

  const goTo = (i: number) => {
    if (i === index) return;
    hapticLight();
    setIndex(i);
    listRef.current?.scrollToOffset({ offset: i * interval, animated: !reduceMotion });
  };

  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(ids.length - 1, Math.round(e.nativeEvent.contentOffset.x / interval)));
    if (i !== index) setIndex(i);
  };

  const ask = (id: PlanId) => {
    const message =
      isPass(id)
        ? `I’d like the ${PLAN_NAMES[id]}${eventTitle ? ` for “${eventTitle}”` : eventId ? ' for one of my events' : ''}.`
        : `I’d like to switch to ${PLAN_NAMES[id]}.`;
    navigation.navigate('Support', { message });
  };

  const store = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play account';
  const converted = priceText(PLAN_PRICES.plus.monthlyUsdCents, currency, rates).converted;
  const saving = (id: 'plus' | 'pro') =>
    yearlySavingPercent(PLAN_PRICES[id].monthlyUsdCents, PLAN_PRICES[id].yearlyUsdCents);

  const cell = (value: string | boolean, paid: boolean) =>
    value === true ? (
      <View accessible accessibilityLabel="Included">
        <CheckIcon size={16} color={paid ? colors.accent : colors.ink} />
      </View>
    ) : value === false ? (
      <Text style={styles.none} accessibilityLabel="Not included">
        –
      </Text>
    ) : (
      <Text style={styles.value}>{value}</Text>
    );

  const renderCard = ({ item: id }: { item: PlanId }) => {
    const isCurrent = id === current;
    let amount: string;
    let per: string;
    let savingLine: string | null = null;
    if (id === 'free') {
      amount = 'Free';
      per = '';
    } else if (isPass(id)) {
      amount = priceText(PLAN_PRICES.passes[id], currency, rates).text;
      per = 'once';
    } else {
      const usd = billing === 'yearly' ? PLAN_PRICES[id].yearlyUsdCents : PLAN_PRICES[id].monthlyUsdCents;
      amount = priceText(usd, currency, rates).text;
      per = billing === 'yearly' ? '/ year' : '/ month';
      if (billing === 'yearly') savingLine = `Save ${saving(id)}% with yearly`;
    }
    return (
      <View style={[styles.card, { width: cardWidth }]}>
        <View style={styles.cardHead}>
          <Text style={type.h2}>{PLAN_NAMES[id]}</Text>
          {isCurrent && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Your plan</Text>
            </View>
          )}
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{amount}</Text>
          {per ? <Text style={styles.per}>{per}</Text> : null}
        </View>
        {savingLine && <Text style={styles.saving}>{savingLine}</Text>}
        {isPass(id) && <Text style={styles.blurb}>{PASS_BLURBS[id]}</Text>}
        {!PURCHASES_LIVE && id !== 'free' && (
          <Text style={styles.blurb}>Free while RollCal is in beta. Tap below and we’ll turn it on.</Text>
        )}

        <View style={styles.rows}>
          {PLAN_COMPARISON.map((r) => (
            <View key={r.feature} style={styles.row}>
              <Text style={styles.feature}>{r.feature}</Text>
              <View style={styles.cellWrap}>{cell(r[id], id !== 'free')}</View>
            </View>
          ))}
        </View>

        {isCurrent ? (
          <Text style={[type.bodyMuted, styles.current]}>You’re on this plan</Text>
        ) : (
          <Button
            title={isPass(id) ? `Get the ${PLAN_NAMES[id]}` : `Switch to ${PLAN_NAMES[id]}`}
            variant="secondary"
            onPress={() => ask(id)}
            style={{ marginTop: spacing.md }}
          />
        )}
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg }}
    >
      <View style={styles.toggleWrap}>
        <View style={styles.toggle} accessibilityRole="tablist">
          {(['every', 'one'] as const).map((g) => (
            <Pressable
              key={g}
              onPress={() => switchGroup(g)}
              accessibilityRole="tab"
              accessibilityState={{ selected: group === g }}
              style={[styles.toggleOption, group === g && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, group === g && styles.toggleTextActive]}>
                {PLAN_GROUP_NAMES[g]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={[type.caption, styles.groupBlurb]}>{PLAN_GROUP_BLURBS[group]}</Text>

      <View style={styles.tabs} accessibilityRole="tablist">
        {ids.map((id, i) => (
          <Pressable
            key={id}
            onPress={() => goTo(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === index }}
            hitSlop={{ top: 10, bottom: 10 }}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.tabText, i === index && styles.tabTextActive]}>{PLAN_NAMES[id]}</Text>
          </Pressable>
        ))}
      </View>

      {/* Only Plus is billed monthly or yearly; Free and passes aren't. The
          row keeps its space so the cards don't jump while swiping. */}
      <View
        style={[
          styles.toggleWrap,
          ids[index] !== 'plus' && { opacity: 0 },
          // Passes are never monthly or yearly: no gap for the switch there.
          group === 'one' && { display: 'none' },
        ]}
        pointerEvents={ids[index] === 'plus' ? 'auto' : 'none'}
        accessibilityElementsHidden={ids[index] !== 'plus'}
      >
        <View style={styles.toggle}>
          {(['monthly', 'yearly'] as const).map((opt) => (
            <Pressable
              key={opt}
              onPress={() => {
                if (opt === billing) return;
                hapticLight();
                setBilling(opt);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: billing === opt }}
              style={[styles.toggleOption, billing === opt && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, billing === opt && styles.toggleTextActive]}>
                {opt === 'monthly' ? 'Monthly' : 'Yearly'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        ref={listRef}
        // A new list per group, so it starts at that group's first card.
        key={group}
        data={ids}
        keyExtractor={(id) => id}
        renderItem={renderCard}
        extraData={`${billing}|${current}|${currency}|${rates ? 1 : 0}|${eventTitle}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={interval}
        decelerationRate="fast"
        disableIntervalMomentum
        initialScrollIndex={group === (isPass(start) ? 'one' : 'every') ? firstIndex : 0}
        getItemLayout={(_, i) => ({ length: interval, offset: i * interval, index: i })}
        contentContainerStyle={{ paddingLeft: spacing.lg, paddingRight: spacing.lg, gap: GAP }}
        onMomentumScrollEnd={onSettle}
        onScrollEndDrag={onSettle}
        style={styles.pager}
      />

      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ids.map((id, i) => (
          <View key={id} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        {converted && (
          <Text style={[type.caption, styles.note]}>
            Plans are priced in US dollars. Prices here are converted to {currency} ({currencyName(currency)}) at today’s exchange rate, as a guide.
            {PURCHASES_LIVE && ` You’re charged in your ${store}’s currency, at the price shown before you confirm.`}{' '}
            <RatesCredit />
          </Text>
        )}
        {PURCHASES_LIVE && (
          <Text style={[type.caption, styles.note]}>
            Payment is charged to your {store} when you confirm. Subscriptions renew automatically unless
            you cancel at least 24 hours before the end of the current period. Manage or cancel any time in
            your account’s subscription settings.
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
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    tabs: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.xl,
      paddingHorizontal: spacing.lg,
    },
    tab: { minHeight: 32, justifyContent: 'center' },
    tabText: { ...t.body, color: c.inkMuted },
    tabTextActive: { fontFamily: fonts.bodySemiBold, color: c.ink },
    toggleWrap: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
    groupBlurb: { textAlign: 'center', paddingHorizontal: spacing.xl, marginTop: -spacing.sm, marginBottom: spacing.md, color: c.inkMuted },
    toggle: {
      flexDirection: 'row',
      backgroundColor: c.line,
      borderRadius: radii.control,
      padding: 3,
    },
    toggleOption: {
      minWidth: 104,
      minHeight: 32,
      borderRadius: radii.control - 3,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleActive: { backgroundColor: c.card },
    toggleText: { ...t.caption, fontFamily: fonts.bodyMedium, color: c.inkMuted },
    toggleTextActive: { fontFamily: fonts.bodySemiBold, color: c.ink },
    pager: { flexGrow: 0 },
    card: {
      backgroundColor: c.card,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      padding: spacing.lg,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    badge: {
      backgroundColor: c.accent,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    badgeText: { ...t.caption, fontFamily: fonts.bodySemiBold, color: c.onAccent },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: spacing.md },
    price: { ...t.display },
    per: { ...t.bodyMuted },
    saving: { ...t.caption, fontFamily: fonts.bodySemiBold, color: c.accentText, marginTop: 2 },
    blurb: { ...t.caption, marginTop: spacing.sm },
    rows: {
      marginTop: spacing.lg,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 36,
    },
    feature: { ...t.bodyMuted, flex: 1 },
    cellWrap: { flexShrink: 0, maxWidth: '50%', alignItems: 'flex-end' },
    value: { ...t.body, fontFamily: fonts.bodyMedium, textAlign: 'right' },
    none: { ...t.bodyMuted, textAlign: 'right' },
    current: { marginTop: spacing.md, textAlign: 'center' },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.line },
    dotActive: { backgroundColor: c.ink },
    footer: { paddingHorizontal: spacing.lg },
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
