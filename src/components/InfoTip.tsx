// A small ⓘ next to a label. Tapping it fades in a short explanation over
// the dimmed page (the app's pop-up style), so screens don't need a
// sentence under every control. Tap anywhere or "Got it" to close.
import { useMemo, useState } from 'react';
import { Modal, PixelRatio, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { hapticLight } from '../lib/haptics';
import { fonts, Palette, radii, spacing } from '../theme';

export default function InfoTip({ title, text }: { title: string; text: string }) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  // Grows a little with the user's text size, like the label beside it.
  const size = Math.round(18 * Math.min(1.4, Math.max(1, PixelRatio.getFontScale())));

  return (
    <>
      <Pressable
        onPress={() => {
          hapticLight();
          setOpen(true);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`About ${title}`}
        style={({ pressed }) => [
          styles.dot,
          { width: size, height: size, borderRadius: size / 2 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={[styles.glyph, { fontSize: size * 0.62, lineHeight: size }]}>i</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.card} onPress={() => {}} accessibilityViewIsModal>
            <Text style={type.h2}>{title}</Text>
            <Text style={[type.body, styles.text]}>{text}</Text>
            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => [styles.done, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.doneText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    dot: {
      borderWidth: 1.25,
      borderColor: c.inkMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    glyph: {
      fontFamily: fonts.bodySemiBold,
      color: c.inkMuted,
      textAlign: 'center',
    },
    scrim: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: radii.card,
      padding: spacing.lg,
    },
    text: { marginTop: spacing.sm, color: c.inkMuted },
    done: { alignSelf: 'flex-end', marginTop: spacing.lg, paddingVertical: spacing.xs },
    doneText: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: c.accentText },
  });
