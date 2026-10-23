// "Who can join" for an event: anyone with the link, people the host
// approves, or only people the host invites (see lib/joinRequests). Used on
// the create/edit form and in the host's event info sheet.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { JOIN_MODES, JoinMode } from '../lib/joinRequests';
import { Palette, spacing } from '../theme';

export default function JoinModePicker({
  value,
  onChange,
}: {
  value: JoinMode;
  onChange: (mode: JoinMode) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View accessibilityRole="radiogroup">
      {JOIN_MODES.map((m) => {
        const selected = value === m.mode;
        return (
          <Pressable
            key={m.mode}
            onPress={() => onChange(m.mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          >
            <View style={styles.text}>
              <Text style={type.body}>{m.label}</Text>
              <Text style={type.caption}>{m.detail}</Text>
            </View>
            <View style={styles.radio}>{selected && <View style={styles.radioFill} />}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    text: { flex: 1 },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: c.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink },
  });
