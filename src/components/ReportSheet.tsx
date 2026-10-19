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
import { REPORT_REASONS, ReportReason, ReportTarget, reportContent } from '../lib/safety';
import { Palette, radii, spacing, TypeTokens } from '../theme';
import { ErrorText } from './ui';

type Props = {
  visible: boolean;
  target: ReportTarget;
  targetId: string;
  targetUserId: string | null;
  // Reads as "Report {subject}", e.g. "this message".
  subject: string;
  onClose: () => void;
};

// A floating card at the bottom, the same look as the Pro pop-up.
export default function ReportSheet({
  visible,
  target,
  targetId,
  targetUserId,
  subject,
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
  const [sent, setSent] = useState(false);

  // Each time it opens, start from a clean form.
  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails('');
    setSending(false);
    setError(null);
    setSent(false);
  }, [visible]);

  const submit = async () => {
    if (!reason || sending || !session) return;
    setSending(true);
    setError(null);
    const err = await reportContent({
      reporterId: session.user.id,
      target,
      targetId,
      targetUserId,
      reason,
      details,
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    hapticLight();
    setSent(true);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[styles.card, { marginBottom: insets.bottom + spacing.xl }]}
          accessibilityViewIsModal
        >
          {sent ? (
            <>
              <Text style={[type.body, { color: colors.ink }]}>
                Thanks. We’ll look at this within 24 hours.
              </Text>
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
          ) : (
            <>
              <Text style={styles.title}>Report {subject}</Text>
              <ScrollView
                style={styles.scroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {REPORT_REASONS.map((r, i) => {
                  const selected = reason === r.value;
                  return (
                    <View key={r.value}>
                      {i > 0 && <View style={styles.divider} />}
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          hapticLight();
                          setReason(r.value);
                        }}
                        style={({ pressed }) => [styles.reasonRow, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={[type.body, { flex: 1 }]}>{r.label}</Text>
                        <View style={styles.radio}>
                          {selected && <View style={styles.radioFill} />}
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
                <TextInput
                  style={styles.input}
                  value={details}
                  onChangeText={setDetails}
                  placeholder="Anything else we should know (optional)"
                  placeholderTextColor={colors.inkMuted}
                  multiline
                  maxLength={1000}
                />
              </ScrollView>
              <ErrorText message={error} />
              <View style={styles.buttons}>
                <Pressable
                  style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
                  onPress={onClose}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
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
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.25)' },
    card: {
      marginHorizontal: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.md,
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
    title: { ...t.h3, color: c.ink, marginBottom: spacing.sm },
    scroll: { flexGrow: 0 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
    reasonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 48,
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
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      textAlignVertical: 'top',
      color: c.ink,
    },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    secondary: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    secondaryText: { ...t.button, color: c.ink },
    primary: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      backgroundColor: c.accent,
    },
    primaryText: { ...t.button, color: c.onAccent },
  });
