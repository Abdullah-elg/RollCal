// Step two of splitting a bill: choose which saved payment methods to show,
// then create and share the bill. On success it replaces this screen and
// the review screen with the bill.

import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon } from '../components/icons';
import { Button, ErrorText, SECTION_GAP } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { createAndShareBill, itemsTotal } from '../lib/bills';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { formatCents } from '../lib/money';
import { formatHandle, listPaymentMethods, methodName, PaymentMethod } from '../lib/paymentMethods';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'BillShare'>;

export default function BillShareScreen({ navigation, route }: Props) {
  const { draft } = route.params;
  const { session } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  const userId = session?.user.id;

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ids already offered, so a refresh keeps the person's choices and only
  // pre-selects the default among methods they haven't seen yet.
  const seen = useRef(new Set<string>());

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let live = true;
      (async () => {
        const res = await listPaymentMethods(userId);
        if (!live) return;
        const fresh = res.methods.filter((m) => !seen.current.has(m.id));
        fresh.forEach((m) => seen.current.add(m.id));
        setMethods(res.methods);
        setSelected((prev) => {
          const kept = prev.filter((id) => res.methods.some((m) => m.id === id));
          const add = fresh.filter((m) => m.is_default).map((m) => m.id);
          return [...kept, ...add.filter((id) => !kept.includes(id))];
        });
        setLoaded(true);
      })();
      return () => {
        live = false;
      };
    }, [userId])
  );

  const toggle = (id: string) => {
    hapticLight();
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const total =
    itemsTotal(draft.items) + draft.taxCents + draft.tipCents + draft.feesCents;

  const share = async () => {
    if (!userId) return;
    setError(null);
    setBusy(true);
    const res = await createAndShareBill(userId, { ...draft, paymentMethodIds: selected });
    setBusy(false);
    if (res.error || !res.billId) {
      setError(res.error ?? 'Could not share the bill. Please try again.');
      return;
    }
    hapticSuccess();
    const billId = res.billId;
    // Swap the review and share screens for the bill, keeping everything up
    // to the event underneath, so Back goes bill -> event -> wherever the
    // event was opened from.
    const routes = navigation.getState().routes;
    let eventIndex = routes.length - 1;
    while (eventIndex > 0 && routes[eventIndex].name !== 'EventDetail') eventIndex--;
    const kept = routes.slice(0, eventIndex + 1).map(({ name, params }) => ({ name, params }));
    navigation.reset({
      index: kept.length,
      routes: [...kept, { name: 'Bill', params: { billId } }],
    });
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.bodyMuted, { marginBottom: spacing.md }]}>
          Pick where people can pay you back. They'll see these on the bill.
        </Text>

        {!loaded ? (
          <ActivityIndicator color={colors.ink} style={{ marginVertical: spacing.lg }} />
        ) : methods.length === 0 ? (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={[type.bodyMuted, { marginBottom: spacing.md }]}>
              You haven't added a receiving method yet.
            </Text>
            <Button
              title="Add a receiving method"
              variant="secondary"
              onPress={() => navigation.navigate('PaymentMethods')}
            />
          </View>
        ) : (
          methods.map((m, i) => {
            const on = selected.includes(m.id);
            return (
              <View key={m.id}>
                {i > 0 && <View style={styles.rowDivider} />}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [styles.methodRow, pressed && { opacity: 0.6 }]}
                  onPress={() => toggle(m.id)}
                >
                  <View style={styles.rowText}>
                    <Text style={type.body}>{methodName(m)}</Text>
                    <Text style={type.caption}>{formatHandle(m.type, m.handle)}</Text>
                  </View>
                  <View style={styles.checkSlot}>
                    {on && <CheckIcon size={18} color={colors.ink} />}
                  </View>
                </Pressable>
              </View>
            );
          })
        )}

        <View style={styles.divider} />

        <Text style={type.bodyMuted}>{draft.title.trim() || 'Bill'}</Text>
        <Text style={styles.total}>{formatCents(total, draft.currency)}</Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <ErrorText message={error} />
        <Button
          title="Share with the event"
          onPress={share}
          loading={busy}
          disabled={selected.length === 0}
        />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette, _t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    content: { padding: spacing.lg },
    methodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    rowText: { flex: 1, gap: 2 },
    checkSlot: { width: 24, alignItems: 'flex-end' },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginVertical: spacing.sm,
    },
    divider: { height: SECTION_GAP },
    total: { fontFamily: fonts.display, fontSize: 36, color: c.ink, letterSpacing: -0.5 },
    footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  });
