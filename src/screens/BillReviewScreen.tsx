import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloseIcon, PlusIcon } from '../components/icons';
import { Button, ErrorText, Field, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { BillDraft, DraftItem, itemsTotal } from '../lib/bills';
import { percentOf, subtotalMismatch } from '../lib/billSplit';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { centsToInput, formatCents, parseCents } from '../lib/money';
import { loadScansLeft } from '../lib/pro';
import { scanReceipt, ScanSource } from '../lib/receiptScan';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'BillReview'>;

type Line = { key: number; name: string; price: string; quantity: string };
type TipMode = 'amount' | 'percent';

const amountText = (cents: number) => (cents > 0 ? centsToInput(cents) : '');

// Empty means zero; anything else must be a valid amount.
const optionalCents = (text: string): number | null =>
  text.trim() === '' ? 0 : parseCents(text);

const parseQuantity = (text: string): number | null => {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= 999 ? n : null;
};

export default function BillReviewScreen({ navigation, route }: Props) {
  const { eventId, draft } = route.params;
  const { profile } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  // A scanned receipt can name its currency; typed bills are in dollars.
  const currency = draft?.currency ?? 'CAD';

  const nextKey = useRef(0);
  const newLine = (item?: DraftItem): Line => ({
    key: nextKey.current++,
    name: item?.name ?? '',
    price: item ? centsToInput(item.priceCents) : '',
    quantity: String(item?.quantity ?? 1),
  });

  const [title, setTitle] = useState(draft?.title ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    draft && draft.items.length > 0 ? draft.items.map((i) => newLine(i)) : [newLine()]
  );
  const [tax, setTax] = useState(amountText(draft?.taxCents ?? 0));
  const [tip, setTip] = useState(amountText(draft?.tipCents ?? 0));
  const [tipMode, setTipMode] = useState<TipMode>('amount');
  const [fees, setFees] = useState(amountText(draft?.feesCents ?? 0));
  const [submitted, setSubmitted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // Free scans left this month; null when Pro or not known yet.
  const isPro = !!profile?.is_pro;
  const [scansLeft, setScansLeft] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (isPro) return;
      loadScansLeft().then(setScansLeft);
    }, [isPro])
  );

  const parsed = lines.map((l) => ({
    priceCents: parseCents(l.price),
    quantity: parseQuantity(l.quantity),
  }));
  const validItems = lines.flatMap((l, i) => {
    const { priceCents, quantity } = parsed[i];
    return priceCents !== null && quantity !== null
      ? [{ name: l.name.trim(), priceCents, quantity }]
      : [];
  });
  const itemsCents = itemsTotal(validItems);

  const taxCents = optionalCents(tax);
  const feesCents = optionalCents(fees);
  let tipCents: number | null;
  if (tipMode === 'percent') {
    const pct = tip.trim() === '' ? 0 : /^\d{0,3}(\.\d{0,2})?$/.test(tip.trim()) ? Number(tip) : NaN;
    tipCents = Number.isFinite(pct) && tip.trim() !== '.' ? percentOf(itemsCents, pct) : null;
  } else {
    tipCents = optionalCents(tip);
  }
  const total = itemsCents + (taxCents ?? 0) + (tipCents ?? 0) + (feesCents ?? 0);

  const mismatch =
    draft && subtotalMismatch(validItems, draft.subtotalCents) !== 0 ? draft.subtotalCents : null;

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: number) => {
    hapticLight();
    setLines((ls) => ls.filter((l) => l.key !== key));
  };

  const addLine = () => {
    hapticLight();
    setLines((ls) => [...ls, newLine()]);
  };

  const switchTipMode = (mode: TipMode) => {
    if (mode === tipMode) return;
    hapticLight();
    setTipMode(mode);
    setTip('');
  };

  const next = () => {
    setSubmitted(true);
    const linesOk =
      lines.length > 0 &&
      lines.every((l, i) => l.name.trim() && parsed[i].priceCents !== null && parsed[i].quantity !== null);
    if (!linesOk || taxCents === null || tipCents === null || feesCents === null) return;
    const items: DraftItem[] = lines.map((l, i) => ({
      name: l.name.trim(),
      priceCents: parsed[i].priceCents as number,
      quantity: parsed[i].quantity as number,
    }));
    const bill: BillDraft = {
      eventId,
      title: title.trim(),
      currency,
      subtotalCents: draft ? draft.subtotalCents : itemsTotal(items),
      taxCents,
      tipCents,
      feesCents,
      items,
      paymentMethodIds: [],
    };
    navigation.navigate('BillShare', { draft: bill });
  };

  const fmt = (cents: number) => formatCents(cents, currency);

  // Reading takes a few seconds. On success the screen starts over with the
  // scanned lines, so everything below is filled in for checking.
  const scan = async (source: ScanSource) => {
    setScanError(null);
    if (!isPro && scansLeft === 0) {
      navigation.navigate('Upgrade', { reason: 'scan' });
      return;
    }
    const result = await scanReceipt(eventId, source, () => setScanning(true));
    setScanning(false);
    if ('error' in result) setScanError(result.error);
    if ('limitReached' in result) {
      setScansLeft(0);
      navigation.navigate('Upgrade', { reason: 'scan' });
    }
    if ('draft' in result) {
      hapticSuccess();
      navigation.replace('BillReview', { eventId, draft: result.draft });
    }
  };
  const scanCaption =
    isPro || scansLeft === null
      ? 'Scan the receipt and the lines fill in, or type them below.'
      : scansLeft > 0
        ? `${scansLeft} free ${scansLeft === 1 ? 'scan' : 'scans'} left this month. Or type the lines below.`
        : 'You’ve used this month’s free scans. Type the lines below, or get Pro to keep scanning.';

  const lineError = (l: Line, i: number): string | null => {
    if (!submitted) return null;
    if (!l.name.trim()) return 'Give this line a name.';
    if (parsed[i].priceCents === null) return 'Enter a price, like 12.50.';
    if (parsed[i].quantity === null) return 'Quantity is a whole number from 1 to 999.';
    return null;
  };

  return (
    <FormScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {draft ? (
          <Text style={[type.bodyMuted, { marginBottom: spacing.md }]}>
            Filled in from the receipt. Check each line before you share.
          </Text>
        ) : scanning ? (
          <View style={styles.scanning}>
            <ActivityIndicator color={colors.ink} />
            <Text style={type.bodyMuted}>Reading the receipt…</Text>
          </View>
        ) : (
          <View style={{ marginBottom: spacing.md }}>
            <View style={styles.scanButtons}>
              <Button
                title="Take a photo"
                variant="secondary"
                onPress={() => scan('camera')}
                style={styles.scanButton}
              />
              <Button
                title="Choose a photo"
                variant="secondary"
                onPress={() => scan('library')}
                style={styles.scanButton}
              />
            </View>
            <Text style={[type.caption, { marginTop: spacing.sm }]}>{scanCaption}</Text>
            {!isPro && (
              <Pressable
                accessibilityRole="link"
                hitSlop={14}
                onPress={() => navigation.navigate('Upgrade', { reason: 'scan' })}
                style={styles.proLink}
              >
                <Text style={styles.proLinkText}>Get Pro</Text>
              </Pressable>
            )}
            <ErrorText message={scanError} />
          </View>
        )}

        <Field
          label="What was it?"
          value={title}
          onChangeText={setTitle}
          placeholder="Dinner"
          maxLength={80}
        />

        {mismatch !== null && (
          <Text style={[type.bodyMuted, { marginBottom: spacing.md }]}>
            Lines add up to {fmt(itemsCents)}, but the receipt says {fmt(mismatch)}. Check for a
            missed or mistyped line.
          </Text>
        )}

        <Text style={styles.sectionHeader}>Items</Text>
        {lines.map((l, i) => {
          const err = lineError(l, i);
          const lineCents = (parsed[i].priceCents ?? 0) * (parsed[i].quantity ?? 0);
          return (
            <View key={l.key}>
              {i > 0 && <View style={styles.rowDivider} />}
              <View style={styles.lineTop}>
                <TextInput
                  style={[styles.nameInput, styles.input]}
                  value={l.name}
                  onChangeText={(v) => updateLine(l.key, { name: v })}
                  placeholder="Item"
                  placeholderTextColor={colors.inkMuted}
                  accessibilityLabel="Item name"
                  maxLength={80}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove line"
                  hitSlop={10}
                  onPress={() => removeLine(l.key)}
                >
                  <CloseIcon size={16} color={colors.inkMuted} />
                </Pressable>
              </View>
              <View style={styles.lineBottom}>
                <TextInput
                  style={[styles.priceInput, styles.input]}
                  value={l.price}
                  onChangeText={(v) => updateLine(l.key, { price: v })}
                  placeholder="0.00"
                  placeholderTextColor={colors.inkMuted}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Price"
                />
                <Text style={type.caption}>×</Text>
                <TextInput
                  style={[styles.qtyInput, styles.input]}
                  value={l.quantity}
                  onChangeText={(v) => updateLine(l.key, { quantity: v })}
                  keyboardType="number-pad"
                  accessibilityLabel="Quantity"
                  maxLength={3}
                />
                <Text style={[type.caption, styles.lineTotal]}>
                  {lineCents > 0 ? fmt(lineCents) : ''}
                </Text>
              </View>
              <ErrorText message={err} />
            </View>
          );
        })}
        {submitted && lines.length === 0 && <ErrorText message="Add at least one line." />}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.addLine, pressed && { opacity: 0.6 }]}
          onPress={addLine}
        >
          <PlusIcon size={16} color={colors.ink} />
          <Text style={styles.addLineText}>Add a line</Text>
        </Pressable>

        <View style={styles.divider} />

        <Field
          label="Tax"
          value={tax}
          onChangeText={setTax}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <ErrorText message={submitted && taxCents === null ? 'Enter an amount, like 4.20.' : null} />

        <View style={styles.tipHead}>
          <Text style={styles.label}>Tip</Text>
          <View style={styles.segmented}>
            {(['amount', 'percent'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityState={{ selected: tipMode === m }}
                onPress={() => switchTipMode(m)}
                style={[styles.segment, tipMode === m && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, tipMode === m && { color: colors.paper }]}>
                  {m === 'amount' ? '$' : '%'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.tipRow}>
          <TextInput
            style={[styles.input, styles.tipInput]}
            value={tip}
            onChangeText={setTip}
            placeholder={tipMode === 'percent' ? '18' : '0.00'}
            placeholderTextColor={colors.inkMuted}
            keyboardType="decimal-pad"
            accessibilityLabel={tipMode === 'percent' ? 'Tip percentage' : 'Tip amount'}
          />
          {tipMode === 'percent' && tipCents !== null && (
            <Text style={type.bodyMuted}>{fmt(tipCents)}</Text>
          )}
        </View>
        <ErrorText
          message={
            submitted && tipCents === null
              ? tipMode === 'percent'
                ? 'Enter a percentage, like 18.'
                : 'Enter an amount, like 8.00.'
              : null
          }
        />

        <Field
          label="Other fees"
          value={fees}
          onChangeText={setFees}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Text style={[type.caption, { marginTop: -spacing.sm, marginBottom: spacing.md }]}>
          Service charge, delivery, that kind of thing
        </Text>
        <ErrorText message={submitted && feesCents === null ? 'Enter an amount, like 3.00.' : null} />

        <View style={styles.divider} />

        <View style={styles.summaryRow}>
          <Text style={type.bodyMuted}>Items</Text>
          <Text style={type.bodyMuted}>{fmt(itemsCents)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={type.bodyMuted}>Tax</Text>
          <Text style={type.bodyMuted}>{fmt(taxCents ?? 0)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={type.bodyMuted}>Tip</Text>
          <Text style={type.bodyMuted}>{fmt(tipCents ?? 0)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={type.bodyMuted}>Fees</Text>
          <Text style={type.bodyMuted}>{fmt(feesCents ?? 0)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={type.h3}>Total</Text>
          <Text style={styles.total}>{fmt(total)}</Text>
        </View>

        <Button title="Next" onPress={next} />
      </ScrollView>
    </FormScreen>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    content: { padding: spacing.lg },
    scanButtons: { flexDirection: 'row', gap: spacing.sm },
    scanButton: { flex: 1 },
    proLink: { alignSelf: 'flex-start', marginTop: spacing.xs },
    proLinkText: { ...t.caption, fontFamily: fonts.bodySemiBold, color: c.ink },
    scanning: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      marginBottom: spacing.md,
    },
    sectionHeader: { ...t.sectionLabel, marginBottom: spacing.sm },
    label: { ...t.caption, fontFamily: fonts.bodyMedium },
    input: {
      ...t.body,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 8,
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: 10,
      backgroundColor: c.card,
    },
    lineTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    nameInput: { flex: 1 },
    lineBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    priceInput: { width: 100 },
    qtyInput: { width: 60, textAlign: 'center' },
    lineTotal: { flex: 1, textAlign: 'right' },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginVertical: spacing.sm,
    },
    addLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    addLineText: { ...t.body, fontFamily: fonts.bodySemiBold },
    divider: { height: 1, backgroundColor: c.line, marginVertical: spacing.md },
    tipHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    segmented: {
      flexDirection: 'row',
      borderRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      overflow: 'hidden',
    },
    segment: { paddingHorizontal: spacing.md, paddingVertical: 6 },
    // Ink, not accent: Next is the one accent action on the screen.
    segmentActive: { backgroundColor: c.ink },
    segmentText: { ...t.caption, fontFamily: fonts.bodySemiBold, color: c.ink },
    tipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.xs,
    },
    tipInput: { flex: 1 },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 2,
    },
    totalRow: { marginTop: spacing.sm, marginBottom: spacing.lg },
    total: { fontFamily: fonts.display, fontSize: 36, color: c.ink, letterSpacing: -0.5 },
  });
