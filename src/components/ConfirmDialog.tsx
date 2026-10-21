// The themed yes/no dialog used in place of Alert.alert for confirmations.

import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Palette, radii, spacing, TypeTokens } from '../theme';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Themed replacement for Alert.alert confirmations, so dialogs stay in the
// app's paper-and-ink language instead of the system gray.
export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={type.h2}>{title}</Text>
          <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>{message}</Text>
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.7 }]}
              onPress={onCancel}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.confirmButton,
                destructive
                  ? styles.destructiveButton
                  : styles.accentButton,
                pressed && { opacity: 0.7 },
              ]}
              onPress={onConfirm}
            >
              <Text
                style={[
                  styles.confirmText,
                  destructive && { color: colors.danger },
                ]}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: c.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.md,
      padding: spacing.lg,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    cancelButton: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    cancelText: {
      ...t.button,
      color: c.ink,
    },
    confirmButton: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
    },
    accentButton: {
      backgroundColor: c.accent,
    },
    destructiveButton: {
      backgroundColor: 'transparent',
    },
    confirmText: {
      ...t.button,
      color: c.onAccent,
    },
  });
