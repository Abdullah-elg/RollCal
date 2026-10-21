// The "open with" chooser for an event's location. Uses each maps app's
// https link, so the app opens when it's installed and the website if not.

import { useMemo } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';

type Props = {
  visible: boolean;
  location: string | null;
  lat: number | null;
  lng: number | null;
  onClose: () => void;
};

// Themed "open with…" chooser for an event's location. Uses each app's
// universal https link, so the app opens when installed and the browser
// version otherwise.
export default function NavAppSheet({ visible, location, lat, lng, onClose }: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  const hasPin = lat != null && lng != null;
  const ll = `${lat},${lng}`;
  const q = encodeURIComponent(location ?? '');

  const options: { label: string; url: string }[] = [
    ...(Platform.OS === 'ios'
      ? [
          {
            label: 'Apple Maps',
            url: hasPin
              ? `http://maps.apple.com/?ll=${ll}&q=${q || 'Event'}`
              : `http://maps.apple.com/?q=${q}`,
          },
        ]
      : []),
    {
      label: 'Google Maps',
      url: `https://www.google.com/maps/search/?api=1&query=${hasPin ? ll : q}`,
    },
    {
      label: 'Waze',
      url: hasPin
        ? `https://waze.com/ul?ll=${ll}&navigate=yes`
        : `https://waze.com/ul?q=${q}&navigate=yes`,
    },
  ];

  const open = (url: string) => {
    onClose();
    Linking.openURL(url);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Open location with</Text>
          {options.map((opt) => (
            <Pressable
              key={opt.label}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}
              onPress={() => open(opt.url)}
            >
              <Text style={styles.optionText}>{opt.label}</Text>
            </Pressable>
          ))}
          <Pressable
            style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
            onPress={onClose}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
      padding: spacing.lg,
    },
    card: {
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      padding: spacing.md,
    },
    title: {
      ...t.body,
      fontSize: 15,
      color: c.inkMuted,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    option: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
    optionText: {
      ...t.body,
      fontFamily: fonts.bodyMedium,
      color: c.ink,
    },
    cancel: {
      marginTop: spacing.sm,
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
  });
