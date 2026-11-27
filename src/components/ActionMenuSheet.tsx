// A small in-app menu of choices, in the same floating card and faded scrim
// as the person menu (PersonActionsSheet), used in place of the system
// action sheet so menus look the same everywhere.

import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { Palette, radii, spacing } from '../theme';

export type MenuOption = { label: string; onPress: () => void; destructive?: boolean };

type Props = {
  visible: boolean;
  title?: string;
  options: MenuOption[];
  onClose: () => void;
};

export default function ActionMenuSheet({ visible, title, options, onClose }: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[styles.card, { marginBottom: insets.bottom + spacing.xl }]}
          accessibilityViewIsModal
        >
          {title ? (
            <>
              <View style={styles.titleRow}>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{title}</Text>
              </View>
              <View style={styles.divider} />
            </>
          ) : null}
          {options.map((o) => (
            <View key={o.label}>
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  onClose();
                  // iOS drops a modal (like the photo picker) that opens
                  // while this one is still closing.
                  setTimeout(o.onPress, 350);
                }}
                accessibilityRole="button"
              >
                <Text style={[type.body, o.destructive && { color: colors.danger }]}>{o.label}</Text>
              </Pressable>
              <View style={styles.divider} />
            </View>
          ))}
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
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.scrim },
    card: {
      marginHorizontal: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.card,
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
    titleRow: { minHeight: 36, justifyContent: 'center' },
    row: { minHeight: 52, justifyContent: 'center' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
  });
