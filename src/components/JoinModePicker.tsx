// "Who can join" for an event: anyone with the link, people the host
// approves, or only people the host invites (see lib/joinRequests). Used on
// the create/edit form and in the host's event info sheet.
//
// A dropdown: the field shows the current choice, and tapping it opens the
// three options right under it. Inline rather than a pop-up, because it also
// sits inside the event info sheet.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { JOIN_MODES, JoinMode } from '../lib/joinRequests';
import { Palette, radii, spacing } from '../theme';
import { CheckIcon, ChevronRightIcon } from './icons';

export default function JoinModePicker({
  value,
  onChange,
}: {
  value: JoinMode;
  onChange: (mode: JoinMode) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const current = JOIN_MODES.find((m) => m.mode === value) ?? JOIN_MODES[0];

  return (
    <View style={[styles.box, open && styles.boxOpen]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Who can join: ${current.label}`}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.text}>
          <Text style={type.body}>{current.label}</Text>
        </View>
        <View style={{ transform: [{ rotate: open ? '270deg' : '90deg' }] }}>
          <ChevronRightIcon size={18} color={colors.inkMuted} />
        </View>
      </Pressable>

      {open && (
        <View accessibilityRole="radiogroup">
          {JOIN_MODES.map((m) => {
            const selected = value === m.mode;
            return (
              <Pressable
                key={m.mode}
                onPress={() => {
                  onChange(m.mode);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}
              >
                <View style={styles.text}>
                  <Text style={type.body}>{m.label}</Text>
                  <Text style={type.caption}>{m.detail}</Text>
                </View>
                <View style={styles.check}>
                  {selected && <CheckIcon size={18} color={colors.ink} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.card,
      overflow: 'hidden',
    },
    boxOpen: {
      borderColor: c.ink,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
    text: { flex: 1, gap: 2 },
    check: { width: 22, alignItems: 'center' },
  });
