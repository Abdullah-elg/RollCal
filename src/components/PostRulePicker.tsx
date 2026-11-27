// "Who can add photos" / "Who can chat" for an event: everyone, or only the
// host plus people they pick (lib/postRules). Used on the create/edit form
// and in the host's event info sheet. Same dropdown as JoinModePicker.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { POST_RULES, PostKind, PostRule } from '../lib/postRules';
import { Palette, radii, spacing } from '../theme';
import { CheckIcon, ChevronRightIcon } from './icons';

export default function PostRulePicker({
  kind,
  value,
  onChange,
}: {
  kind: PostKind;
  value: PostRule;
  onChange: (rule: PostRule) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const options = POST_RULES[kind];
  const current = options.find((m) => m.rule === value) ?? options[0];

  return (
    <View style={[styles.box, open && styles.boxOpen]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Who can ${kind === 'photos' ? 'add photos' : 'chat'}: ${current.label}`}
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
          {options.map((m) => {
            const selected = value === m.rule;
            return (
              <Pressable
                key={m.rule}
                onPress={() => {
                  onChange(m.rule);
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
