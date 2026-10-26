// A shared bill. Everyone claims what they had and sees what they owe. They
// can send a payment, and the person who paid can confirm payments, send
// reminders and edit the bill. Updates arrive live.

import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import ConfirmDialog from '../components/ConfirmDialog';
import RatesCredit from '../components/RatesCredit';
import { CheckIcon } from '../components/icons';
import { Button, ErrorText } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Bill,
  BillDetail,
  BillItem,
  billTotal,
  deleteBill,
  draftFromBill,
  listEventBills,
  loadBill,
} from '../lib/bills';
import { itemCoverage, ItemPick, MAX_SPLIT, Quote, quotePicks } from '../lib/billSplit';
import { describeRate } from '../lib/currency';
import { setStringAsync } from '../lib/clipboard';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { centsToInput, formatCents, parseCents } from '../lib/money';
import { copyableHandle, formatHandle, methodName, PaymentMethod } from '../lib/paymentMethods';
import {
  countGoing,
  leftToPay,
  loadPayments,
  loadPeople,
  loadPicks,
  markReceived,
  Payment,
  Person,
  remindEveryone,
  removePayment,
  REMIND_GAP_MS,
  savePicks,
  sendPayment,
  subscribeToPayments,
} from '../lib/payments';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'Bill'>;

const MAX_AVATARS = 3;
const ALL_PICK: ItemPick = { mode: 'fraction', numerator: 1, denominator: 1 };
const EVEN_PICK: ItemPick = { mode: 'even' };
// iPhone number pads have no Done key, so the typed chips share a bar with one.
const DONE_BAR_ID = 'claim-done';
const HIT = { top: 12, bottom: 12, left: 12, right: 12 };
const NO_QUOTE: Quote = { subtotalCents: 0, extrasCents: 0, totalCents: 0 };

function sameChoice(a: ItemPick, b: ItemPick) {
  if (a.mode === 'fraction' && b.mode === 'fraction') {
    return a.numerator === b.numerator && a.denominator === b.denominator;
  }
  if (a.mode === 'amount' && b.mode === 'amount') return a.amountCents === b.amountCents;
  return a.mode === b.mode;
}

// Picks come back from storage, so a bad one shouldn't take the screen down.
function quoteOf(bill: Bill, items: BillItem[], picks: Record<string, ItemPick>, going: number) {
  try {
    return quotePicks(
      items.map((i) => ({ id: i.id, priceCents: i.price_cents, quantity: i.quantity })),
      { taxCents: bill.tax_cents, tipCents: bill.tip_cents, feesCents: bill.other_fees_cents },
      picks,
      going
    );
  } catch {
    return NO_QUOTE;
  }
}

// Another bill you could pay in the same go: same person paid, same event,
// same currency, and you've picked what you had so the amount is known.
type OtherOwed = {
  billId: string;
  title: string;
  cents: number;
  picks: Record<string, ItemPick>;
};

// The other bills on this event you owe the same person on. Left out: bills
// you haven't picked your items on yet, ones already paid up, and ones where
// a payment of yours is still waiting to be marked received.
async function loadOtherOwed(current: Bill, myId: string, going: number): Promise<OtherOwed[]> {
  const summaries = await listEventBills(current.event_id);
  const candidates = summaries.filter(
    (s) =>
      s.bill.id !== current.id &&
      s.bill.created_by === current.created_by &&
      s.bill.status !== 'draft' &&
      s.bill.currency === current.currency &&
      s.totalCents > s.paidCents
  );
  const found = await Promise.all(
    candidates.map(async (s): Promise<OtherOwed | null> => {
      const [detail, picks, payments] = await Promise.all([
        loadBill(s.bill.id),
        loadPicks(myId, s.bill.id),
        loadPayments(s.bill.id),
      ]);
      if (!detail) return null;
      if (payments.some((p) => p.user_id === myId && p.status === 'sent')) return null;
      const quote = quoteOf(detail.bill, detail.items, picks, going);
      const left = leftToPay(billTotal(detail.bill, detail.items), payments);
      const cents = Math.min(quote.totalCents, left);
      return cents > 0
        ? { billId: s.bill.id, title: detail.bill.title || 'Bill', cents, picks }
        : null;
    })
  );
  return found.filter((o): o is OtherOwed => o !== null);
}

export default function BillScreen({ navigation, route }: Props) {
  const { billId } = route.params;
  const { session } = useAuth();
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const myId = session?.user.id ?? '';

  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [goingCount, setGoingCount] = useState(1);
  // What this person had. Kept on this phone only until they send a payment.
  const [picks, setPicks] = useState<Record<string, ItemPick>>({});
  const [error, setError] = useState<string | null>(null);
  // Which typed chip is being edited ("itemId:1/" or "itemId:$"), so the
  // other chips on that item stop looking selected meanwhile.
  const [editingChip, setEditingChip] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Other bills from the same person, offered when sending ("Pay together?").
  const [offer, setOffer] = useState<OtherOwed[] | null>(null);
  // Set once they chose to pay those too: the send dialog then covers them all.
  const [bundle, setBundle] = useState<OtherOwed[] | null>(null);
  const [checkingOthers, setCheckingOthers] = useState(false);
  const [takeBack, setTakeBack] = useState<Payment | null>(null);
  const [turnDown, setTurnDown] = useState<Payment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Who or what is mid-request ("send", "remind", or a payment id), so a double
  // tap can't fire twice. The ref blocks at once; the state redraws buttons.
  const [busy, setBusy] = useState<string[]>([]);
  const busyRef = useRef(new Set<string>());

  // Fetches names for anyone we haven't seen yet.
  const askedFor = useRef(new Set<string>());
  const learnPeople = useCallback(async (userIds: string[]) => {
    const missing = [...new Set(userIds)].filter((id) => !askedFor.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => askedFor.current.add(id));
    const found = await loadPeople(missing);
    setPeople((known) => ({ ...known, ...found }));
  }, []);

  // Removals only carry an id, so the live feed checks it against these.
  const paymentIds = useRef(new Set<string>());
  const refreshPayments = useCallback(async () => {
    const rows = await loadPayments(billId);
    paymentIds.current = new Set(rows.map((p) => p.id));
    setPayments(rows);
    await learnPeople(rows.map((p) => p.user_id));
  }, [billId, learnPeople]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadBill(billId).then(async (d) => {
        if (!live) return;
        setDetail(d);
        setLoaded(true);
        navigation.setOptions({ title: d?.bill.title || 'Bill' });
        if (!d) return;
        const [going, saved] = await Promise.all([
          countGoing(d.bill.event_id),
          loadPicks(myId, billId),
          refreshPayments(),
          learnPeople([d.bill.created_by]),
        ]).then(([g, p]) => [g, p] as const);
        if (!live) return;
        setGoingCount(going);
        setPicks(saved);
      });
      return () => {
        live = false;
      };
    }, [billId, myId, navigation, refreshPayments, learnPeople])
  );

  useEffect(
    () => subscribeToPayments(billId, (id) => paymentIds.current.has(id), refreshPayments),
    [billId, refreshPayments]
  );

  // The person who paid can fix the bill from the header.
  useEffect(() => {
    if (!detail || detail.bill.created_by !== myId) {
      navigation.setOptions({ headerRight: undefined });
      return;
    }
    const receivedCents = payments
      .filter((p) => p.status === 'received')
      .reduce((sum, p) => sum + p.amount_cents, 0);
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() =>
            navigation.navigate('BillReview', {
              eventId: detail.bill.event_id,
              draft: draftFromBill(detail),
              editBillId: detail.bill.id,
              receivedCents,
            })
          }
          hitSlop={12}
          accessibilityRole="button"
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={styles.headerAction}>Edit</Text>
        </Pressable>
      ),
    });
  }, [detail, payments, myId, navigation, styles]);

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={type.bodyMuted}>This bill isn't available.</Text>
      </View>
    );
  }

  const { bill, items, paymentMethods, creatorName, eventTitle } = detail;
  const fmt = (cents: number) => formatCents(cents, bill.currency);
  const extras = [
    { label: 'Tax', cents: bill.tax_cents },
    { label: 'Tip', cents: bill.tip_cents },
    { label: 'Other fees', cents: bill.other_fees_cents },
  ].filter((e) => e.cents > 0);

  const isCreator = bill.created_by === myId;
  const total = billTotal(bill, items);
  const left = leftToPay(total, payments);
  const paidUp = total > 0 && left === 0;
  const open = bill.status !== 'draft' && !paidUp;
  const received = payments.filter((p) => p.status === 'received');
  const waiting = payments.filter((p) => p.status === 'sent');
  const mySent = waiting.filter((p) => p.user_id === myId);
  const quote = quoteOf(bill, items, picks, goingCount);
  const hasPicks = items.some((i) => picks[i.id]);
  const coverage = itemCoverage(
    items.map((i) => ({ id: i.id, priceCents: i.price_cents, quantity: i.quantity })),
    received.flatMap((p) => p.items)
  );
  const nameOf = (id: string) => (id === myId ? 'You' : (people[id]?.name ?? 'Someone'));
  const now = Date.now();
  const recentlyReminded =
    !!bill.last_reminded_at && now - Date.parse(bill.last_reminded_at) < REMIND_GAP_MS;

  const changePicks = (next: Record<string, ItemPick>) => {
    setPicks(next);
    savePicks(myId, bill.id, next);
  };

  const pickItem = (itemId: string, pick: ItemPick | null) => {
    hapticLight();
    const { [itemId]: _dropped, ...rest } = picks;
    changePicks(pick ? { ...rest, [itemId]: pick } : rest);
  };

  const toggle = (itemId: string, someonePaid: boolean) => {
    if (picks[itemId]) pickItem(itemId, null);
    else pickItem(itemId, someonePaid ? EVEN_PICK : ALL_PICK);
  };

  // Runs one write, then reloads payments. Keyed so the same row can't run
  // twice. Returns the failure so the send dialog can show it in place.
  const run = async (
    key: string,
    write: () => Promise<string | null>,
    onDone?: () => void,
    quiet = false
  ) => {
    if (busyRef.current.has(key)) return null;
    busyRef.current.add(key);
    setBusy([...busyRef.current]);
    setError(null);
    const failure = await write();
    if (failure) {
      if (!quiet) setError(failure);
    } else onDone?.();
    await refreshPayments();
    busyRef.current.delete(key);
    setBusy([...busyRef.current]);
    return failure;
  };

  const submitPayment = (cents: number) =>
    run(
      'send',
      () => sendPayment(bill.id, cents, picks, goingCount),
      () => {
        hapticSuccess();
        setSending(false);
        changePicks({});
      },
      true
    );

  // This bill's part plus each other bill's, sent as one payment per bill
  // (so each bill keeps its own record), stopping at the first that fails.
  const submitBundle = (others: OtherOwed[], thisCents: number) =>
    run(
      'send',
      async () => {
        const first = await sendPayment(bill.id, thisCents, picks, goingCount);
        if (first) return first;
        for (const o of others) {
          const failed = await sendPayment(o.billId, o.cents, o.picks, goingCount);
          if (failed) return `${o.title}: ${failed}`;
          await savePicks(myId, o.billId, {});
        }
        return null;
      },
      () => {
        hapticSuccess();
        setSending(false);
        setBundle(null);
        changePicks({});
      },
      true
    );

  // Before sending, see whether there are other bills from the same person
  // to pay in the same go. Only when this bill's own amount is known.
  const startSending = async () => {
    setBundle(null);
    if (isCreator || quote.totalCents <= 0) {
      setSending(true);
      return;
    }
    setCheckingOthers(true);
    const others = await loadOtherOwed(bill, myId, goingCount).catch(() => []);
    setCheckingOthers(false);
    if (others.length > 0) setOffer(others);
    else setSending(true);
  };

  // iOS drops a modal opened while another is still closing.
  const afterOffer = (others: OtherOwed[] | null) => {
    setOffer(null);
    setBundle(others);
    setTimeout(() => setSending(true), 350);
  };

  // The success haptic is saved for the payment that settles the bill.
  const receive = (p: Payment, isReceived: boolean) =>
    run(
      p.id,
      () => markReceived(p.id, isReceived),
      isReceived ? (left - p.amount_cents <= 0 ? hapticSuccess : hapticLight) : undefined
    );

  const remind = () =>
    run(
      'remind',
      () => remindEveryone(bill.id),
      () => {
        hapticLight();
        setDetail((d) =>
          d ? { ...d, bill: { ...d.bill, last_reminded_at: new Date().toISOString() } } : d
        );
      }
    );

  const removeBill = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    setError(null);
    const failure = await deleteBill(bill.id);
    setDeleting(false);
    if (failure) {
      setError(failure);
      return;
    }
    hapticLight();
    navigation.goBack();
  };

  const confirmRemoval = () => {
    const p = takeBack ?? turnDown;
    setTakeBack(null);
    setTurnDown(null);
    if (p) run(p.id, () => removePayment(p.id));
  };

  const coversText = (p: Payment) => {
    const names = p.items
      .map((x) => items.find((i) => i.id === x.itemId)?.name)
      .filter((n): n is string => !!n);
    return names.length > 0 ? `For ${names.join(', ')}` : 'Just an amount';
  };

  return (
    <View style={styles.screen}>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={DONE_BAR_ID}>
          <View style={styles.doneBar}>
            <Pressable onPress={Keyboard.dismiss} hitSlop={8} accessibilityRole="button">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={type.title}>{bill.title || 'Bill'}</Text>
        <Text style={[type.bodyMuted, { marginTop: spacing.xs }]}>Paid by {creatorName}</Text>
        {eventTitle ? <Text style={type.caption}>{eventTitle}</Text> : null}
        {bill.scanned_currency && bill.scanned_rate ? (
          <Text style={type.caption}>
            Receipt in {bill.scanned_currency}, converted at{' '}
            {describeRate(bill.scanned_currency, bill.currency, Number(bill.scanned_rate))}.{' '}
            <RatesCredit />
          </Text>
        ) : null}
        <Text style={styles.total}>{fmt(left)}</Text>
        {paidUp ? (
          <Text style={type.bodyMuted}>Everyone's paid up.</Text>
        ) : received.length > 0 ? (
          <Text style={type.bodyMuted}>left of {fmt(total)}</Text>
        ) : null}

        {bill.status === 'draft' && isCreator && (
          <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>Not shared yet.</Text>
        )}

        <View style={styles.divider} />

        {open && (
          <>
            <Text style={[type.bodyMuted, { marginBottom: spacing.sm }]}>
              Tap what you had. Use the fractions if you shared something.
            </Text>
            <View style={{ height: spacing.sm }} />
          </>
        )}

        {items.map((item, i) => {
          const cover = coverage.find((c) => c.itemId === item.id);
          const state = cover?.state ?? 'unpaid';
          const mine = picks[item.id];
          const typingHere = editingChip?.startsWith(`${item.id}:`) ?? false;
          const payerIds = [
            ...new Set(
              received.filter((p) => p.items.some((x) => x.itemId === item.id)).map((p) => p.user_id)
            ),
          ].sort((a, b) => (a === myId ? -1 : b === myId ? 1 : 0));
          const shown = payerIds.slice(0, MAX_AVATARS);
          const extra = payerIds.length - shown.length;

          let caption = '';
          if (state === 'partial') caption = `${Math.round((cover?.covered ?? 0) * 100)}% paid`;
          else if (state === 'full') caption = `Paid by ${payerIds.map(nameOf).join(', ')}`;
          else if (state === 'over') caption = 'Paid more than once over';

          const content = (
            <>
              {open && (
                <View style={[styles.box, !!mine && styles.boxChecked]}>
                  {mine && <CheckIcon size={16} color={colors.paper} />}
                </View>
              )}
              <View style={styles.rowText}>
                <Text style={type.body}>{item.name}</Text>
                {item.quantity > 1 && (
                  <Text style={type.caption}>
                    {item.quantity} × {fmt(item.price_cents)}
                  </Text>
                )}
                {caption !== '' && (
                  <Text style={[type.caption, state === 'over' && { color: colors.danger }]}>
                    {caption}
                  </Text>
                )}
              </View>
              {shown.length > 0 && (
                <View style={styles.avatars}>
                  {shown.map((id, n) => (
                    <View key={id} style={[styles.avatarWrap, n > 0 && styles.avatarOverlap]}>
                      <Avatar
                        userId={id}
                        name={people[id]?.fullName}
                        avatarUrl={people[id]?.avatarUrl}
                        size={24}
                      />
                    </View>
                  ))}
                  {extra > 0 && <Text style={[type.caption, styles.avatarMore]}>+{extra}</Text>}
                </View>
              )}
              <Text style={type.body}>{fmt(item.price_cents * item.quantity)}</Text>
            </>
          );

          return (
            <View key={item.id}>
              {i > 0 && <View style={styles.rowDivider} />}
              {open ? (
                <Pressable
                  style={styles.row}
                  onPress={() => toggle(item.id, state !== 'unpaid')}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!mine }}
                  accessibilityLabel={item.name}
                >
                  {content}
                </Pressable>
              ) : (
                <View style={styles.row}>{content}</View>
              )}
              {open && mine && (
                <View style={styles.pickerWrap}>
                  <View style={styles.chips}>
                    <Chip
                      label="All"
                      selected={!typingHere && sameChoice(mine, ALL_PICK)}
                      styles={styles}
                      onPress={() => !sameChoice(mine, ALL_PICK) && pickItem(item.id, ALL_PICK)}
                    />
                    <Chip
                      label="Split evenly"
                      selected={!typingHere && mine.mode === 'even'}
                      styles={styles}
                      onPress={() => mine.mode !== 'even' && pickItem(item.id, EVEN_PICK)}
                    />
                    <TypeInChip
                      prefix="1/"
                      label="Split by a number"
                      suppressed={typingHere && editingChip !== `${item.id}:1/`}
                      onEditingChange={(on) => {
                        const id = `${item.id}:1/`;
                        setEditingChip((cur) => (on ? id : cur === id ? null : cur));
                      }}
                      placeholder="__"
                      value={
                        mine.mode === 'fraction' && mine.denominator > 1
                          ? String(mine.denominator)
                          : ''
                      }
                      keyboardType="number-pad"
                      styles={styles}
                      onCommit={(text) => {
                        const n = Number(text);
                        if (!/^\d+$/.test(text) || n < 1 || n > MAX_SPLIT) {
                          return `Pick a number from 2 to ${MAX_SPLIT}.`;
                        }
                        pickItem(
                          item.id,
                          n === 1 ? ALL_PICK : { mode: 'fraction', numerator: 1, denominator: n }
                        );
                        return null;
                      }}
                    />
                    <TypeInChip
                      prefix="$"
                      label="Exact amount"
                      suppressed={typingHere && editingChip !== `${item.id}:$`}
                      onEditingChange={(on) => {
                        const id = `${item.id}:$`;
                        setEditingChip((cur) => (on ? id : cur === id ? null : cur));
                      }}
                      placeholder="0"
                      clearOnFocus
                      value={mine.mode === 'amount' && mine.amountCents ? centsToInput(mine.amountCents) : ''}
                      keyboardType="decimal-pad"
                      styles={styles}
                      onCommit={(text) => {
                        const amountCents = parseCents(text);
                        const line = item.price_cents * item.quantity;
                        if (amountCents === null || amountCents <= 0 || amountCents > line) {
                          return `Enter an amount up to ${fmt(line)}.`;
                        }
                        pickItem(
                          item.id,
                          amountCents === line ? ALL_PICK : { mode: 'amount', amountCents }
                        );
                        return null;
                      }}
                    />
                  </View>
                  {mine.mode === 'even' && (
                    <Text style={[type.caption, { marginTop: spacing.xs }]}>
                      Split between the {goingCount} {goingCount === 1 ? 'person' : 'people'} going
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.divider} />

        {extras.map((e) => (
          <View key={e.label} style={styles.summaryRow}>
            <Text style={type.bodyMuted}>{e.label}</Text>
            <Text style={type.bodyMuted}>{fmt(e.cents)}</Text>
          </View>
        ))}
        <View style={styles.summaryRow}>
          <Text style={type.bodyMuted}>Total</Text>
          <Text style={type.bodyMuted}>{fmt(total)}</Text>
        </View>
        {received.length > 0 && <Text style={styles.paidHeader}>Paid</Text>}
        {received.map((p) => (
          <View key={p.id} style={styles.summaryRow}>
            <View style={[styles.rowText, styles.paidName]}>
              <Text style={type.bodyMuted} numberOfLines={1}>
                {nameOf(p.user_id)}
              </Text>
              {isCreator && (
                <Pressable
                  onPress={() =>
                    p.user_id === myId ? run(p.id, () => removePayment(p.id)) : receive(p, false)
                  }
                  disabled={busy.includes(p.id)}
                  hitSlop={HIT}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.user_id === myId ? 'Remove' : 'Undo'} ${nameOf(p.user_id)}'s payment`}
                >
                  <View style={styles.paidActionWrap}>
                    <Text style={styles.paidAction}>{p.user_id === myId ? 'Remove' : 'Undo'}</Text>
                  </View>
                </Pressable>
              )}
            </View>
            <Text style={type.bodyMuted}>−{fmt(p.amount_cents)}</Text>
          </View>
        ))}
        {open || received.length > 0 ? (
          <View style={[styles.summaryRow, { marginTop: spacing.xs }]}>
            <Text style={type.body}>Left to pay</Text>
            <Text style={type.body}>{fmt(left)}</Text>
          </View>
        ) : null}

        {!isCreator && mySent.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionHeader}>Your sent payments</Text>
            {mySent.map((p, i) => (
              <View key={p.id}>
                {i > 0 && <View style={styles.rowDivider} />}
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={type.body}>{fmt(p.amount_cents)} sent</Text>
                    <Text style={type.caption}>Waiting for {creatorName} to confirm</Text>
                  </View>
                  <Pressable
                    onPress={() => setTakeBack(p)}
                    disabled={busy.includes(p.id)}
                    hitSlop={HIT}
                    accessibilityRole="button"
                    style={styles.plainAction}
                  >
                    <Text style={type.bodyMuted}>Take back</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        {isCreator && waiting.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionHeader}>Waiting for you</Text>
            {waiting.map((p, i) => {
              const working = busy.includes(p.id);
              return (
                <View key={p.id}>
                  {i > 0 && <View style={styles.rowDivider} />}
                  <View style={styles.row}>
                    <Avatar
                      userId={p.user_id}
                      name={people[p.user_id]?.fullName}
                      avatarUrl={people[p.user_id]?.avatarUrl}
                      size={32}
                    />
                    <View style={styles.rowText}>
                      <Text style={type.body}>{nameOf(p.user_id)}</Text>
                      <Text style={type.caption}>{coversText(p)}</Text>
                    </View>
                    <Text style={type.body}>{fmt(p.amount_cents)}</Text>
                  </View>
                  <View style={styles.shareActions}>
                    <Pressable
                      onPress={() => setTurnDown(p)}
                      disabled={working}
                      hitSlop={HIT}
                      accessibilityRole="button"
                      style={styles.plainAction}
                    >
                      <Text style={type.bodyMuted}>Didn't get it</Text>
                    </Pressable>
                    <Button
                      title="Received"
                      variant="secondary"
                      disabled={working}
                      onPress={() => receive(p, true)}
                      style={styles.smallButton}
                    />
                  </View>
                </View>
              );
            })}
          </>
        )}

        {isCreator && (
          <>
            <View style={styles.divider} />
            {!open && <ErrorText message={error} />}
            <Pressable
              onPress={() => setConfirmDelete(true)}
              disabled={deleting}
              hitSlop={HIT}
              accessibilityRole="button"
              style={[styles.plainAction, { alignSelf: 'center' }]}
            >
              <Text style={[type.body, { color: colors.danger }]}>
                {deleting ? 'Deleting…' : 'Delete bill'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete this bill?"
        message={
          payments.length > 0
            ? `It disappears for everyone, along with the ${payments.length} ${
                payments.length === 1 ? 'payment' : 'payments'
              } recorded on it. Money already sent isn't affected; sort that out between you.`
            : 'It disappears for everyone in the event.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={removeBill}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        visible={!!takeBack}
        title="Take back this payment?"
        message="Only do this if you didn't actually send it."
        confirmLabel="Take back"
        onConfirm={confirmRemoval}
        onCancel={() => setTakeBack(null)}
      />
      <ConfirmDialog
        visible={!!turnDown}
        title="Didn't get it?"
        message={`This removes ${turnDown ? nameOf(turnDown.user_id) : 'their'}${
          turnDown && turnDown.user_id !== myId ? "'s" : ''
        } payment so they can send it again.`}
        confirmLabel="Remove"
        onConfirm={confirmRemoval}
        onCancel={() => setTurnDown(null)}
      />
      <SendDialog
        visible={sending}
        title={isCreator ? 'Add your part' : bundle ? `Pay ${creatorName} for ${bundle.length + 1} bills` : 'Send a payment'}
        helper={
          isCreator
            ? 'This counts toward the bill straight away.'
            : `Send it with one of these, then tap Send. ${creatorName} marks it received once it arrives.`
        }
        // The person who paid doesn't pay themselves.
        methods={isCreator ? [] : paymentMethods}
        payee={creatorName}
        confirmLabel={isCreator ? 'Add' : 'Send'}
        initial={quote.totalCents > 0 ? centsToInput(Math.min(quote.totalCents, left)) : ''}
        left={left}
        fmt={fmt}
        working={busy.includes('send')}
        breakdown={
          bundle
            ? [
                { label: bill.title || 'This bill', cents: Math.min(quote.totalCents, left) },
                ...bundle.map((o) => ({ label: o.title, cents: o.cents })),
              ]
            : undefined
        }
        onSubmit={(cents) =>
          bundle ? submitBundle(bundle, Math.min(quote.totalCents, left)) : submitPayment(cents)
        }
        onCancel={() => {
          setSending(false);
          setBundle(null);
        }}
        styles={styles}
      />

      <OfferDialog
        visible={!!offer}
        payee={creatorName}
        lines={
          offer
            ? [
                { label: bill.title || 'This bill', cents: Math.min(quote.totalCents, left) },
                ...offer.map((o) => ({ label: o.title, cents: o.cents })),
              ]
            : []
        }
        fmt={fmt}
        onTogether={() => afterOffer(offer)}
        onJustThis={() => afterOffer(null)}
        onClose={() => setOffer(null)}
        styles={styles}
      />

      {open && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <ErrorText message={error} />
          {hasPicks ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={type.bodyMuted}>Your items</Text>
                <Text style={type.bodyMuted}>{fmt(quote.subtotalCents)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={type.bodyMuted}>Tax, tip and fees</Text>
                <Text style={type.bodyMuted}>{fmt(quote.extrasCents)}</Text>
              </View>
              <View style={styles.yourTotal}>
                <Text style={type.body}>Your total</Text>
                <Text style={styles.barTotal}>{fmt(quote.totalCents)}</Text>
              </View>
            </>
          ) : (
            <Text style={type.bodyMuted}>Pick what you had, or send any amount.</Text>
          )}
          <View style={{ marginTop: spacing.md }}>
            <Button
              title={
                isCreator
                  ? 'Add my part'
                  : quote.totalCents > 0
                  ? `Send ${fmt(quote.totalCents)} to ${creatorName}`
                  : 'Send a payment'
              }
              disabled={busy.includes('send') || checkingOthers}
              loading={checkingOthers}
              onPress={startSending}
            />
          </View>
          {isCreator && (
            <Pressable
              onPress={remind}
              disabled={recentlyReminded || busy.includes('remind')}
              hitSlop={HIT}
              accessibilityRole="button"
              style={[styles.plainAction, { alignSelf: 'center' }]}
            >
              <Text style={type.bodyMuted}>
                {recentlyReminded ? 'Reminded today' : 'Remind everyone'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// Asks how much to send. Looks like ConfirmDialog, plus an amount field.
function SendDialog({
  visible,
  title,
  helper,
  confirmLabel,
  initial,
  left,
  fmt,
  working,
  methods,
  payee,
  breakdown,
  onSubmit,
  onCancel,
  styles,
}: {
  visible: boolean;
  title: string;
  helper: string;
  confirmLabel: string;
  initial: string;
  left: number;
  fmt: (cents: number) => string;
  working: boolean;
  // Where the money can go, each with a Pay button that copies the handle.
  methods: PaymentMethod[];
  payee: string;
  // Paying several bills in one go: each bill's part, shown instead of the
  // amount field, and their total is what gets sent.
  breakdown?: { label: string; cents: number }[];
  onSubmit: (cents: number) => Promise<string | null>;
  onCancel: () => void;
  styles: Styles;
}) {
  const { type } = useTheme();
  const bundleTotal = breakdown?.reduce((sum, b) => sum + b.cents, 0) ?? null;
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Start fresh each time it opens.
  useEffect(() => {
    if (visible) {
      setText(initial);
      setProblem(null);
      setCopiedId(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Copies the handle to paste into the payment app or bank app.
  const copy = async (m: PaymentMethod) => {
    Keyboard.dismiss();
    if (!(await setStringAsync(copyableHandle(m.type, m.handle)))) {
      setProblem('Could not copy that. Try holding the handle to copy it.');
      return;
    }
    hapticLight();
    setProblem(null);
    setCopiedId(m.id);
  };

  const typed = bundleTotal ?? parseCents(text);
  const send = typed && typed > 0 ? `send ${fmt(typed)}` : 'send it';
  const copiedMessage = (m: PaymentMethod) =>
    m.type === 'interac'
      ? `Copied. Open your bank app and ${send} by e-Transfer.`
      : m.type === 'zelle'
        ? `Copied. Open your bank app and ${send} with Zelle.`
        : m.type === 'other'
          ? `Copied. ${send[0].toUpperCase()}${send.slice(1)} the way they asked.`
          : `Copied. Open ${methodName(m)} and ${send}.`;

  const submit = async () => {
    if (bundleTotal !== null) {
      setProblem(null);
      setProblem(await onSubmit(bundleTotal));
      return;
    }
    const cents = parseCents(text);
    if (cents === null || cents <= 0 || cents > left) {
      setProblem(`Enter an amount up to ${fmt(left)}.`);
      return;
    }
    setProblem(null);
    setProblem(await onSubmit(cents));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.dialog}>
          <Text style={type.h2}>{title}</Text>
          {breakdown ? (
            <View style={styles.bundleList}>
              {breakdown.map((b, i) => (
                <View key={i} style={styles.summaryRow}>
                  <Text style={[type.bodyMuted, { flex: 1 }]} numberOfLines={1}>
                    {b.label}
                  </Text>
                  <Text style={type.bodyMuted}>{fmt(b.cents)}</Text>
                </View>
              ))}
              <View style={styles.yourTotal}>
                <Text style={type.body}>Total</Text>
                <Text style={styles.barTotal}>{fmt(bundleTotal ?? 0)}</Text>
              </View>
            </View>
          ) : (
            <TextInput
              value={text}
              onChangeText={(t) => setText(t.replace(/[^\d.]/g, '').slice(0, 9))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={styles.splitPlaceholder.color}
              style={styles.dialogInput}
              accessibilityLabel="Amount"
            />
          )}
          {problem ? <ErrorText message={problem} /> : null}
          {methods.length > 0 && (
            <View style={styles.dialogMethods}>
              <Text style={styles.sectionHeader}>Pay {payee} with</Text>
              {methods.map((m, i) => (
                <View key={m.id}>
                  {i > 0 && <View style={styles.rowDivider} />}
                  <View style={styles.methodRow}>
                    <View style={styles.rowText}>
                      <Text style={type.body}>{methodName(m)}</Text>
                      <Text style={type.caption} selectable>
                        {formatHandle(m.type, m.handle)}
                      </Text>
                    </View>
                    <Button
                      title="Pay"
                      variant="secondary"
                      onPress={() => copy(m)}
                      style={styles.payButton}
                    />
                  </View>
                  {copiedId === m.id && <Text style={styles.copied}>{copiedMessage(m)}</Text>}
                </View>
              ))}
            </View>
          )}
          <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>{helper}</Text>
          <View style={styles.dialogButtons}>
            <Pressable
              style={({ pressed }) => [styles.dialogCancel, pressed && { opacity: 0.7 }]}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={styles.dialogCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.dialogConfirm,
                (pressed || working) && { opacity: 0.7 },
              ]}
              onPress={submit}
              disabled={working}
              accessibilityRole="button"
            >
              <Text style={styles.dialogConfirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// "You also owe Amr on 2 other bills": pay them all in one go, or just this
// one. Closing it (back, or tapping outside) does neither.
function OfferDialog({
  visible,
  payee,
  lines,
  fmt,
  onTogether,
  onJustThis,
  onClose,
  styles,
}: {
  visible: boolean;
  payee: string;
  lines: { label: string; cents: number }[];
  fmt: (cents: number) => string;
  onTogether: () => void;
  onJustThis: () => void;
  onClose: () => void;
  styles: Styles;
}) {
  const { type } = useTheme();
  const others = lines.length - 1;
  const total = lines.reduce((sum, l) => sum + l.cents, 0);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.dialog}>
          <Text style={type.h2}>
            You also owe {payee} on {others} other {others === 1 ? 'bill' : 'bills'}
          </Text>
          <Text style={[type.bodyMuted, { marginTop: spacing.xs }]}>
            Pay them together in one payment?
          </Text>
          <View style={styles.bundleList}>
            {lines.map((l, i) => (
              <View key={i} style={styles.summaryRow}>
                <Text style={[type.bodyMuted, { flex: 1 }]} numberOfLines={1}>
                  {l.label}
                </Text>
                <Text style={type.bodyMuted}>{fmt(l.cents)}</Text>
              </View>
            ))}
            <View style={styles.yourTotal}>
              <Text style={type.body}>Together</Text>
              <Text style={styles.barTotal}>{fmt(total)}</Text>
            </View>
          </View>
          <View style={styles.dialogButtons}>
            <Pressable
              style={({ pressed }) => [styles.dialogCancel, pressed && { opacity: 0.7 }]}
              onPress={onJustThis}
              accessibilityRole="button"
            >
              <Text style={styles.dialogCancelText}>Just this bill</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.dialogConfirm, pressed && { opacity: 0.7 }]}
              onPress={onTogether}
              accessibilityRole="button"
            >
              <Text style={styles.dialogConfirmText}>Pay together</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// A chip you type into: "1/__" for how many ways you shared it, "$__" for an
// exact amount. Saved when you finish typing; onCommit returns an error to
// show, or null once it has saved. With clearOnFocus the old number goes as
// soon as you tap, ready for a new one; leaving it empty keeps the old one.
function TypeInChip({
  prefix,
  label,
  value,
  placeholder,
  clearOnFocus = false,
  suppressed,
  onEditingChange,
  keyboardType,
  onCommit,
  styles,
}: {
  prefix: string;
  label: string;
  value: string;
  placeholder: string;
  clearOnFocus?: boolean;
  // Another chip on this item is being typed in, so don't look selected.
  suppressed: boolean;
  onEditingChange: (editing: boolean) => void;
  keyboardType: 'number-pad' | 'decimal-pad';
  onCommit: (text: string) => string | null;
  styles: Styles;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const input = useRef<TextInput>(null);
  // Highlighted while typing too, so it's clear the chip wants a number.
  const active = editing || (value !== '' && !suppressed);

  // Follow changes made elsewhere (another chip, or a reload).
  useEffect(() => setText(value), [value]);

  // Android keeps the field focused when the keyboard is dismissed with Back,
  // so treat the keyboard closing as finishing.
  useEffect(() => {
    if (!editing) return;
    const sub = Keyboard.addListener('keyboardDidHide', () => input.current?.blur());
    return () => sub.remove();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    onEditingChange(false);
    if (text === value) return;
    if (text === '') {
      setText(value);
      return;
    }
    const problem = onCommit(text);
    if (problem) {
      setText(value);
      setError(problem);
    } else {
      setError(null);
    }
  };

  const textStyle = [styles.chipText, active && styles.chipTextSelected];

  return (
    <View>
      <Pressable
        onPress={() => input.current?.focus()}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        style={[styles.chip, styles.splitChip, active && styles.chipSelected]}
      >
        <Text style={textStyle}>{prefix}</Text>
        {/* TextInput doesn't size itself to its text, so a hidden copy of the
            text measures it and the input takes that width. */}
        <Text
          style={[styles.chipText, styles.measure]}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          {text || placeholder}
        </Text>
        <TextInput
          ref={input}
          value={text}
          placeholder={placeholder}
          placeholderTextColor={active ? styles.splitPlaceholderActive.color : styles.splitPlaceholder.color}
          onChangeText={(t) =>
            setText(
              keyboardType === 'number-pad'
                ? t.replace(/\D/g, '').slice(0, 3)
                : t.replace(/[^\d.]/g, '').slice(0, 8)
            )
          }
          onFocus={() => {
            setEditing(true);
            onEditingChange(true);
            setError(null);
            if (clearOnFocus) setText('');
          }}
          onEndEditing={commit}
          keyboardType={keyboardType}
          inputAccessoryViewID={DONE_BAR_ID}
          returnKeyType="done"
          style={[textStyle, styles.splitInput, { width: Math.ceil(width) + 2 }]}
          accessibilityLabel={label}
        />
      </Pressable>
      {error ? <Text style={styles.chipError}>{error}</Text> : null}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  styles,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    center: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    content: { padding: spacing.lg },
    total: {
      fontFamily: fonts.display,
      fontSize: 40,
      color: c.ink,
      letterSpacing: -0.5,
      marginTop: spacing.md,
    },
    divider: { height: 1, backgroundColor: c.line, marginVertical: spacing.md },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginVertical: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      minHeight: 44,
    },
    box: {
      width: 24,
      height: 24,
      borderRadius: radii.sm,
      borderWidth: 1.5,
      borderColor: c.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxChecked: { backgroundColor: c.ink },
    avatars: { flexDirection: 'row', alignItems: 'center' },
    avatarWrap: { borderRadius: radii.full, borderWidth: 2, borderColor: c.paper },
    avatarOverlap: { marginLeft: -10 },
    avatarMore: { marginLeft: spacing.xs },
    pickerWrap: { paddingLeft: 24 + spacing.md, paddingTop: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      minHeight: 44,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: c.line,
    },
    chipSelected: { backgroundColor: c.ink, borderColor: c.ink },
    chipText: { fontFamily: fonts.body, fontSize: 15, color: c.ink },
    chipTextSelected: { color: c.paper },
    splitChip: { flexDirection: 'row' },
    dialogMethods: { marginTop: spacing.md },
    methodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    payButton: { minWidth: 72 },
    copied: { ...t.caption, marginTop: spacing.xs },
    doneBar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: c.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
    doneText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: c.ink },
    chipError: { ...t.caption, color: c.danger, marginTop: spacing.xs, maxWidth: 220 },
    // No default padding (Android adds some), so it lines up with the prefix.
    splitInput: { padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: 'center' },
    measure: { position: 'absolute', opacity: 0 },
    splitPlaceholder: { color: c.inkMuted },
    splitPlaceholderActive: { color: c.line },
    bar: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
      backgroundColor: c.paper,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    yourTotal: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
    },
    barTotal: { fontFamily: fonts.display, fontSize: 32, color: c.ink, letterSpacing: -0.5 },
    rowText: { flex: 1, gap: 2 },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 2,
    },
    shareActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
    smallButton: { minWidth: 72 },
    plainAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    headerAction: { ...t.body, fontFamily: fonts.bodySemiBold, color: c.ink },
    overlay: {
      flex: 1,
      backgroundColor: c.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    dialog: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.md,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    dialogInput: {
      ...t.body,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      height: 48,
      marginTop: spacing.sm,
    },
    dialogButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    bundleList: { marginTop: spacing.md, gap: spacing.xs },
    dialogCancel: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    dialogCancelText: { ...t.button, color: c.ink },
    dialogConfirm: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      backgroundColor: c.accent,
    },
    dialogConfirmText: { ...t.button, color: c.onAccent },
    sectionHeader: { ...t.sectionLabel, marginBottom: spacing.sm },
    paidHeader: {
      ...t.caption,
      color: c.ink,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    paidName: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    // A drawn line rather than a text underline, which iOS renders lighter
    // or heavier depending on where the row lands on the pixel grid.
    paidActionWrap: {
      borderBottomWidth: PixelRatio.roundToNearestPixel(0.75),
      borderBottomColor: c.ink,
    },
    paidAction: { ...t.caption, color: c.ink },
  });
