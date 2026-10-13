import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import QRScannerModal from './QRScannerModal';
import { useTheme } from '../context/ThemeContext';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: 'CreateEvent' | 'JoinEvent', params?: { code?: string }) => void;
};

export default function CreateOrJoinModal({ visible, onClose, onNavigate }: Props) {
  const { colors, type } = useTheme();
  const styles = makeStyles(colors, type);
  const [showScanner, setShowScanner] = useState(false);

  return (
    <>
      <Modal
        visible={visible && !showScanner}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <Pressable style={styles.menuOverlay} onPress={onClose}>
          <Pressable style={styles.menuCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.menuHeader}>Add or Join</Text>

            <Pressable
              style={({ pressed }) => [styles.menuOption, pressed && { opacity: 0.7 }]}
              onPress={() => {
                onClose();
                onNavigate('CreateEvent');
              }}
            >
              <Text style={styles.menuTitle}>New event</Text>
              <Text style={type.caption}>
                Pick a time and place. The album comes with it
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuOption, pressed && { opacity: 0.7 }]}
              onPress={() => {
                onClose();
                onNavigate('JoinEvent');
              }}
            >
              <Text style={styles.menuTitle}>Join with code</Text>
              <Text style={type.caption}>Use an invite code a friend sent you</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuOption, pressed && { opacity: 0.7 }]}
              onPress={() => {
                setShowScanner(true);
              }}
            >
              <Text style={styles.menuTitle}>Join with QR code</Text>
              <Text style={type.caption}>Scan an event pass or QR invite</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.menuCancel, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <QRScannerModal
        visible={showScanner}
        onScanned={(code) => {
          setShowScanner(false);
          onClose();
          onNavigate('JoinEvent', { code });
        }}
        onClose={() => {
          setShowScanner(false);
          onClose();
        }}
        onManualEntry={() => {
          setShowScanner(false);
          onClose();
          onNavigate('JoinEvent');
        }}
      />
    </>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    menuOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    menuCard: {
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      padding: spacing.md,
      gap: spacing.sm,
    },
    menuHeader: {
      ...t.h3,
      fontFamily: fonts.heading,
      color: c.ink,
      marginBottom: 2,
      paddingHorizontal: spacing.xs,
    },
    menuOption: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.sm,
      padding: spacing.md,
      gap: 2,
    },
    menuTitle: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
    },
    menuCancel: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
      marginTop: 2,
    },
    menuCancelText: {
      ...t.button,
      color: c.ink,
    },
  });
