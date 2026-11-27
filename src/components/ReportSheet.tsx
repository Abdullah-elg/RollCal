// The form for reporting a person, event, message or photo: pick a reason,
// add optional details, send. The report itself is sent by lib/safety.
// For a photo or video in an album (hostId given), it first asks who should
// look at it: the host or RollCal support (rules in lib/reportRoute).

import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hapticLight } from '../lib/haptics';
import { alsoToSupport, canSendToHost, ReportRoute, sentMessage } from '../lib/reportRoute';
import { REPORT_REASONS, ReportReason, ReportTarget, reportContent } from '../lib/safety';
import { Palette, radii, spacing, TypeTokens } from '../theme';
import { ArrowIcon, CloseIcon } from './icons';
import { ErrorText } from './ui';

type Props = {
  visible: boolean;
  target: ReportTarget;
  targetId: string;
  targetUserId: string | null;
  // Reads as "Report {subject}", e.g. "this message".
  subject: string;
  // The event's host, for photos and videos: offers "The host" as where to
  // send it. Left out, it goes to support as always.
  hostId?: string | null;
  onClose: () => void;
};

// A floating card at the bottom, the same look as the Pro pop-up.
export default function ReportSheet({
  visible,
  target,
  targetId,
  targetUserId,
  subject,
  hostId,
  onClose,
}: Props) {
  const { session } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReportRoute | null>(null);
  const askHost =
    !!session &&
    canSendToHost({ target, reporterId: session.user.id, uploaderId: targetUserId, hostId });
  // Whom to send it to; asked first when the host is an option.
  const [route, setRoute] = useState<ReportRoute | null>(null);
  const [step, setStep] = useState<'who' | 'form'>('form');

  // Each time it opens, start from a clean form.
  useEffect(() => {
    if (!visible) return;
    setStep(askHost ? 'who' : 'form');
    setRoute(askHost ? null : 'support');
    setReason(null);
    setDetails('');
    setSending(false);
    setError(null);
    setSent(null);
    // askHost only matters as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = async () => {
    if (!reason || sending || !session) return;
    setSending(true);
    setError(null);
    const result = await reportContent({
      reporterId: session.user.id,
      target,
      targetId,
      targetUserId,
      reason,
      details,
      route: route === 'host' ? 'host' : 'support',
    });
    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    hapticLight();
    setSent(result.route);
  };

  const radioRow = (
    key: string,
    selected: boolean,
    label: string,
    onPress: () => void,
    note?: string,
    // A choice that moves on to the next step shows an arrow, like the + sheet, not a radio.
    goesOn = false
  ) => (
    <Pressable
      key={key}
      accessibilityRole={goesOn ? 'button' : 'radio'}
      accessibilityState={goesOn ? undefined : { selected }}
      onPress={() => {
        hapticLight();
        onPress();
      }}
      style={({ pressed }) => [styles.reasonRow, pressed && { opacity: 0.6 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body}>{label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {goesOn ? (
        <ArrowIcon size={16} color={colors.inkMuted} direction="right" />
      ) : (
        <View style={styles.radio}>{selected && <View style={styles.radioFill} />}</View>
      )}
    </Pressable>
  );

  // Title with the close button; there's no Cancel button.
  const header = (title: string) => (
    <View style={styles.header}>
      <Text style={[styles.title, { flex: 1 }]}>{title}</Text>
      <Pressable
        onPress={onClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
      >
        <CloseIcon size={18} color={colors.ink} />
      </Pressable>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[styles.card, { marginBottom: insets.bottom + spacing.xl }]}
          accessibilityViewIsModal
        >
          {sent && reason ? (
            <>
              <Text style={[type.body, { color: colors.ink }]}>{sentMessage(sent, reason, route ?? 'support')}</Text>
              <View style={styles.buttons}>
                <Pressable
                  style={({ pressed }) => [styles.primary, pressed && { opacity: 0.7 }]}
                  onPress={onClose}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              </View>
            </>
          ) : step === 'who' ? (
            <>
              {header(`Report ${subject}`)}
              <Text style={styles.note}>Who should look at it?</Text>
              {/* Picking one goes straight on to the reasons. */}
              {radioRow(
                'host',
                route === 'host',
                'The host',
                () => {
                  setRoute('host');
                  setStep('form');
                },
                'They can keep it or delete it. They won’t see who reported it.',
                true
              )}
              <View style={styles.divider} />
              {radioRow(
                'support',
                route === 'support',
                'RollCal support',
                () => {
                  setRoute('support');
                  setStep('form');
                },
                'We’ll look at it within 24 hours.',
                true
              )}
            </>
          ) : (
            <>
              {header(route === 'host' ? `Report ${subject} to the host` : `Report ${subject}`)}
              <ScrollView
                style={styles.scroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {REPORT_REASONS.map((r, i) => (
                  <View key={r.value}>
                    {i > 0 && <View style={styles.divider} />}
                    {radioRow(r.value, reason === r.value, r.label, () => setReason(r.value))}
                  </View>
                ))}
                <TextInput
                  style={styles.input}
                  value={details}
                  onChangeText={setDetails}
                  placeholder={
                    route === 'host'
                      ? 'Anything else the host should know (optional)'
                      : 'Anything else we should know (optional)'
                  }
                  placeholderTextColor={colors.inkMuted}
                  multiline
                  maxLength={1000}
                />
              </ScrollView>
              {route === 'host' && alsoToSupport('host', reason) && (
                <Text style={[styles.note, { marginTop: spacing.sm }]}>
                  Because of this reason, RollCal support will see it too.
                </Text>
              )}
              <ErrorText message={error} />
              <View style={styles.buttons}>
                {askHost && (
                  <Pressable
                    style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
                    onPress={() => {
                      setStep('who');
                      setError(null);
                    }}
                    disabled={sending}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryText}>Back</Text>
                  </Pressable>
                )}
                <Pressable
                  style={({ pressed }) => [
                    styles.primary,
                    (!reason || sending) && { opacity: 0.5 },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={submit}
                  disabled={!reason || sending}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>Report</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    // The same backdrop as the people and map sheets: faded in place, in the
    // app's scrim, never sliding up with the card.
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.scrim },
    card: {
      marginHorizontal: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      padding: spacing.lg,
      maxHeight: '85%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 8,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    close: { paddingTop: 2 },
    title: { ...t.h3, color: c.ink, marginBottom: spacing.sm },
    note: { ...t.caption, color: c.inkMuted },
    scroll: { flexGrow: 0 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
    reasonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 52,
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
    input: {
      ...t.body,
      minHeight: 72,
      marginTop: spacing.md,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      textAlignVertical: 'top',
      color: c.ink,
    },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    secondary: {
      flex: 1,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    secondaryText: { ...t.button, color: c.ink },
    primary: {
      flex: 1,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control,
      backgroundColor: c.accent,
    },
    primaryText: { ...t.button, color: c.onAccent },
  });
