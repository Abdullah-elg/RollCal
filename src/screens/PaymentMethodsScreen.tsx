// Manage saved payment handles: add, edit, remove and choose the default.
// Bills show these to the people who owe money.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getLocales } from 'expo-localization';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button, EmptyNote, ErrorText, Field, FormScreen, ThemedSwitch } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hapticSuccess } from '../lib/haptics';
import {
  addPaymentMethod,
  formatHandle,
  listPaymentMethods,
  methodName,
  normalizeHandle,
  normalizeMethodName,
  PAYMENT_TYPES,
  PaymentMethod,
  PaymentMethodType,
  paymentTypesFor,
  removePaymentMethod,
  setDefaultPaymentMethod,
  updatePaymentMethod,
} from '../lib/paymentMethods';
import { PAYMENT_NAME_MAX } from '../lib/limits';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'PaymentMethods'>;

// null = sheet closed, 'new' = adding, otherwise the method being edited.
type SheetTarget = 'new' | PaymentMethod | null;

// The phone's region setting stands in for where they are, so the usual
// ways to pay there come first without asking for location.
const TYPE_CHOICES = paymentTypesFor(getLocales()[0]?.regionCode);

export default function PaymentMethodsScreen(_props: Props) {
  const { session } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  const userId = session?.user.id;

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<SheetTarget>(null);
  const [methodType, setMethodType] = useState<PaymentMethodType>(TYPE_CHOICES.main[0]);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [handle, setHandle] = useState('');
  // The name for an "Other" method, like "Wise".
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) return;
    const res = await listPaymentMethods(userId);
    setMethods(res.methods);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const editing = target !== null && target !== 'new' ? target : null;
  const isFirst = target === 'new' && methods.length === 0;
  const info = PAYMENT_TYPES[editing ? editing.type : methodType];

  const openAdd = () => {
    setMethodType(TYPE_CHOICES.main[0]);
    setShowAllTypes(false);
    setHandle('');
    setName('');
    setMakeDefault(false);
    setError(null);
    setTarget('new');
  };

  const openEdit = (m: PaymentMethod) => {
    setMethodType(m.type);
    setHandle(m.handle);
    setName(m.label ?? '');
    setMakeDefault(m.is_default);
    setError(null);
    setTarget(m);
  };

  const closeSheet = () => {
    if (busy) return;
    setTarget(null);
  };

  const save = async () => {
    if (!userId || !target) return;
    const chosenType = editing ? editing.type : methodType;
    const result = normalizeHandle(chosenType, handle);
    const label = chosenType === 'other' ? normalizeMethodName(name) : null;
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setBusy(true);
    let res: { error: string | null };
    if (editing) {
      res =
        result.handle === editing.handle && label === editing.label
          ? { error: null }
          : await updatePaymentMethod(editing.id, result.handle, label);
      if (!res.error && makeDefault && !editing.is_default) {
        res = await setDefaultPaymentMethod(userId, editing.id);
      }
    } else {
      res = await addPaymentMethod(userId, methodType, result.handle, makeDefault, label);
    }
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    hapticSuccess();
    setTarget(null);
    reload();
  };

  const toggleAllTypes = () => {
    // Hiding the extra row takes away a choice that was on it.
    if (showAllTypes && !TYPE_CHOICES.main.includes(methodType)) {
      setMethodType(TYPE_CHOICES.main[0]);
      setError(null);
    }
    setShowAllTypes((v) => !v);
  };

  const renderChips = (types: PaymentMethodType[]) => (
    <View style={styles.typeChips}>
      {types.map((t) => (
        <Pressable
          key={t}
          accessibilityRole="radio"
          accessibilityState={{ selected: methodType === t }}
          onPress={() => {
            setMethodType(t);
            setError(null);
          }}
          style={({ pressed }) => [
            styles.typeChip,
            methodType === t && styles.typeChipActive,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.typeChipText, methodType === t && { color: colors.paper }]}
          >
            {PAYMENT_TYPES[t].shortLabel}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const remove = async () => {
    if (!userId || !editing) return;
    setConfirmRemove(false);
    setBusy(true);
    const res = await removePaymentMethod(userId, editing.id);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setTarget(null);
    reload();
  };

  const alreadyDefault = editing?.is_default ?? false;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.bodyMuted, { marginBottom: spacing.md }]}>
          Where friends send money when you pay for the group. Nothing moves
          through RollCal.
        </Text>
        {loaded && methods.length === 0 ? (
          <EmptyNote>No payment methods yet.</EmptyNote>
        ) : (
          methods.map((m, i) => (
            <View key={m.id}>
              {i > 0 && <View style={styles.rowDivider} />}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.methodRow, pressed && { opacity: 0.6 }]}
                onPress={() => openEdit(m)}
              >
                <View style={styles.rowText}>
                  <Text style={type.body}>{methodName(m)}</Text>
                  <Text style={type.caption}>{formatHandle(m.type, m.handle)}</Text>
                </View>
                {m.is_default && <Text style={type.caption}>Default</Text>}
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Button title="Add a payment method" onPress={openAdd} />
      </View>

      <Modal
        visible={target !== null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS === 'android'}
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={closeSheet}
      >
        <View style={Platform.OS === 'android' ? styles.sheetOverlay : { flex: 1 }}>
          <SafeAreaView
            style={[styles.screen, Platform.OS === 'android' && styles.androidSheetCard]}
            edges={['bottom']}
          >
            {Platform.OS === 'android' && (
              <View style={styles.sheetHandleBar}>
                <View style={styles.sheetHandle} />
              </View>
            )}
            <View style={styles.sheetHeader}>
              <Text style={type.h2}>
                {editing ? 'Edit payment method' : 'Add a payment method'}
              </Text>
              <Pressable onPress={closeSheet} hitSlop={8}>
                <Text style={styles.sheetDone}>Cancel</Text>
              </Pressable>
            </View>
            <FormScreen style={styles.screen}>
              <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
              >
                {editing ? (
                  <Text style={[type.body, { marginBottom: spacing.md }]}>{info.label}</Text>
                ) : (
                  <>
                    {/* The usual ways to pay here; the rest go on their own
                        row underneath once "Show more" is pressed. */}
                    {renderChips(TYPE_CHOICES.main)}
                    {showAllTypes && renderChips(TYPE_CHOICES.more)}
                    {TYPE_CHOICES.more.length > 0 && (
                      <Pressable
                        onPress={toggleAllTypes}
                        hitSlop={8}
                        style={({ pressed }) => [styles.showMore, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.showMoreText}>
                          {showAllTypes ? 'Show less' : 'Show more'}
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
                {(editing ? editing.type : methodType) === 'other' && (
                  <Field
                    label="Name (optional)"
                    value={name}
                    onChangeText={setName}
                    placeholder="For example, Wise"
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={PAYMENT_NAME_MAX}
                  />
                )}
                {(editing ? editing.type : methodType) === 'other' && (
                  <Text style={styles.counter}>
                    {name.length} / {PAYMENT_NAME_MAX}
                  </Text>
                )}
                <Field
                  label={info.fieldLabel}
                  value={handle}
                  onChangeText={setHandle}
                  placeholder={info.placeholder}
                  keyboardType={info.keyboard}
                  autoCapitalize={info.capitalize ? 'sentences' : 'none'}
                  autoCorrect={false}
                  maxLength={100}
                />
                {!isFirst && (
                  <View style={styles.switchRow}>
                    <Text style={[type.body, { flex: 1 }]}>Make this my default</Text>
                    <View
                      style={alreadyDefault && { opacity: 0.5 }}
                      pointerEvents={alreadyDefault ? 'none' : 'auto'}
                    >
                      <ThemedSwitch value={makeDefault} onValueChange={setMakeDefault} />
                    </View>
                  </View>
                )}
                <ErrorText message={error} />
                <Button title="Save" onPress={save} loading={busy} disabled={!handle.trim()} />
                {editing && (
                  <Button
                    title="Remove"
                    variant="danger"
                    onPress={() => setConfirmRemove(true)}
                    disabled={busy}
                    style={{ marginTop: spacing.sm }}
                  />
                )}
              </ScrollView>
            </FormScreen>
          </SafeAreaView>
        </View>
        <ConfirmDialog
          visible={confirmRemove}
          title="Remove this payment method?"
          message="People won't see it on new bills."
          confirmLabel="Remove"
          destructive
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    content: {
      padding: spacing.lg,
    },
    methodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginVertical: spacing.sm,
    },
    footer: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    typeChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    typeChip: {
      paddingVertical: 8,
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.paper,
    },
    // Ink, not accent: Save is the one accent-coloured action on the sheet.
    typeChipActive: {
      backgroundColor: c.ink,
      borderColor: c.ink,
    },
    typeChipText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    // Same as the description counter on the event form.
    counter: {
      ...t.caption,
      color: c.inkMuted,
      textAlign: 'right',
      marginTop: -spacing.sm,
      marginBottom: spacing.md,
    },
    showMore: {
      alignSelf: 'flex-start',
      paddingVertical: spacing.xs,
      marginBottom: spacing.md,
    },
    showMoreText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.inkMuted,
      textDecorationLine: 'underline',
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    sheetOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
    },
    androidSheetCard: {
      marginTop: (RNStatusBar.currentHeight ?? 24) + 12,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      overflow: 'hidden',
    },
    sheetHandleBar: {
      alignItems: 'center',
      paddingTop: spacing.sm,
      paddingBottom: 2,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.line,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: Platform.OS === 'android' ? spacing.xs : spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    sheetDone: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
  });
