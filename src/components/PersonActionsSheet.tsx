// The small menu for one person with Report and Block, plus an optional extra
// action such as the host's "Remove from event". It hands off between
// modals one at a time because iOS drops a modal opened mid-close.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { hapticLight } from '../lib/haptics';
import { blockUser, ReportTarget } from '../lib/safety';
import { Palette, radii, spacing } from '../theme';
import ConfirmDialog from './ConfirmDialog';
import ReportSheet from './ReportSheet';
import { ErrorText } from './ui';

export type ActionsPerson = { id: string; name: string };

type Props = {
  // null keeps everything closed.
  person: ActionsPerson | null;
  // What "Report" reports. Defaults to the person.
  report?: { target: ReportTarget; targetId: string; subject: string; label: string };
  // An extra action listed first, like "Remove from event" for the host. The
  // list closes before it runs, so it can open its own sheet.
  extra?: { label: string; onPress: () => void };
  onClose: () => void;
  onBlocked: () => void;
};

// 'switching': the list has closed and the next sheet hasn't opened yet.
type Stage = 'menu' | 'switching' | 'confirm' | 'report';

// Report and Block for one person, from a small floating list. Block asks
// first; Report opens the report sheet.
export default function PersonActionsSheet({ person, report, extra, onClose, onBlocked }: Props) {
  const { session } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('menu');
  const [error, setError] = useState<string | null>(null);

  // Always open on the list. The person is only null while closed.
  const personId = person?.id;
  useEffect(() => {
    setStage('menu');
    setError(null);
  }, [personId]);

  // Kept after close so the sheets don't blank out while they animate away.
  const [last, setLast] = useState<ActionsPerson | null>(null);
  useEffect(() => {
    if (person) setLast(person);
  }, [person]);
  const shown = person ?? last;
  if (!shown) return null;

  // iOS drops a modal that opens while another is still closing, so the next
  // sheet waits for the list to finish animating away.
  const goTo = (next: 'menu' | 'confirm' | 'report') => {
    setStage('switching');
    setTimeout(() => setStage(next), 350);
  };

  const reportInfo = report ?? {
    target: 'user' as const,
    targetId: shown.id,
    subject: shown.name,
    label: `Report ${shown.name}`,
  };

  const block = async () => {
    if (!session) return;
    const err = await blockUser(session.user.id, shown.id);
    if (err) {
      setError(err);
      goTo('menu');
      return;
    }
    hapticLight();
    onClose();
    onBlocked();
  };

  return (
    <>
      <Modal
        visible={!!person && stage === 'menu'}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          <View
            style={[styles.card, { marginBottom: insets.bottom + spacing.xl }]}
            accessibilityViewIsModal
          >
            <ErrorText message={error} />
            {extra && (
              <>
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    onClose();
                    // Same iOS modal handoff as goTo.
                    setTimeout(extra.onPress, 350);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[type.body, { color: colors.danger }]}>{extra.label}</Text>
                </Pressable>
                <View style={styles.divider} />
              </>
            )}
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={() => goTo('report')}
              accessibilityRole="button"
            >
              <Text style={type.body}>{reportInfo.label}</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={() => goTo('confirm')}
              accessibilityRole="button"
            >
              <Text style={[type.body, { color: colors.danger }]}>Block {shown.name}</Text>
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={onClose}
              accessibilityRole="button"
            >
              <Text style={[type.body, { color: colors.inkMuted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!person && stage === 'confirm'}
        title={`Block ${shown.name}?`}
        message="They won’t be able to add you as a friend or invite you, and you won’t see their messages or photos. They won’t be told."
        confirmLabel="Block"
        destructive
        onConfirm={block}
        onCancel={() => goTo('menu')}
      />

      <ReportSheet
        visible={!!person && stage === 'report'}
        target={reportInfo.target}
        targetId={reportInfo.targetId}
        targetUserId={shown.id}
        subject={reportInfo.subject}
        onClose={onClose}
      />
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The same backdrop as NavAppSheet: faded in place, in the app's scrim.
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.scrim },
    card: {
      marginHorizontal: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 8,
    },
    row: { minHeight: 48, justifyContent: 'center' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
  });
