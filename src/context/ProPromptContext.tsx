import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticLight } from '../lib/haptics';
import { PRO_PROMPTS, ProPromptReason } from '../lib/pro';
import { Palette, radii, spacing, TypeTokens } from '../theme';
import { useTheme } from './ThemeContext';

// The small Pro pop-up. Any screen calls showProPrompt('video') when a free
// account reaches for a Pro feature; it floats over the bottom of the screen
// with what they can't do, and "See Pro" opens the full upgrade screen.

type ProPromptValue = { showProPrompt: (reason: ProPromptReason) => void };

const ProPromptContext = createContext<ProPromptValue | null>(null);

export function ProPromptProvider({
  onSeePro,
  children,
}: {
  // Opens the full upgrade screen; the navigator owns that.
  onSeePro: (reason: ProPromptReason) => void;
  children: ReactNode;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ProPromptReason | null>(null);

  const showProPrompt = useCallback((next: ProPromptReason) => {
    hapticLight();
    setReason(next);
  }, []);
  const value = useMemo(() => ({ showProPrompt }), [showProPrompt]);

  const close = () => setReason(null);
  const seePro = () => {
    const current = reason;
    setReason(null);
    if (current) onSeePro(current);
  };
  const prompt = reason ? PRO_PROMPTS[reason] : null;

  return (
    <ProPromptContext.Provider value={value}>
      {children}
      <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
          {prompt && (
            <View
              style={[styles.card, { marginBottom: insets.bottom + spacing.xl }]}
              accessibilityViewIsModal
            >
              <Text style={styles.title}>{prompt.title}</Text>
              <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>{prompt.body}</Text>
              <View style={styles.buttons}>
                <Pressable
                  style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
                  onPress={close}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Not now</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.primary, pressed && { opacity: 0.7 }]}
                  onPress={seePro}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>See Pro</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </ProPromptContext.Provider>
  );
}

export function useProPrompt(): ProPromptValue {
  const value = useContext(ProPromptContext);
  if (!value) throw new Error('useProPrompt must be used inside ProPromptProvider');
  return value;
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    // The same backdrop as the people and map sheets: faded in place, in the
    // app's scrim, so it doesn't slide up with the card.
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.scrim },
    card: {
      marginHorizontal: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      padding: spacing.lg,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 8,
    },
    title: { ...t.h3, color: c.ink },
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
