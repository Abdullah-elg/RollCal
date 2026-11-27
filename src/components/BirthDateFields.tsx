import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { MONTHS } from '../lib/age';
import { Palette, radii, spacing, TypeTokens } from '../theme';
import { Field } from './ui';

// Birth year, then the month only if the year alone can't settle it. Asked
// neutrally: nothing here hints at the age needed.
export default function BirthDateFields({
  year,
  onYear,
  month,
  onMonth,
  askMonth,
}: {
  year: string;
  onYear: (v: string) => void;
  month: number | null;
  onMonth: (m: number) => void;
  askMonth: boolean;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  return (
    <View>
      <Field
        label="Year you were born"
        value={year}
        onChangeText={(v) => onYear(v.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="YYYY"
        autoComplete="birthdate-year"
      />
      {askMonth && (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={styles.label}>Month you were born</Text>
          <View style={styles.months}>
            {MONTHS.map((name, i) => {
              const selected = month === i + 1;
              return (
                <Pressable
                  key={name}
                  onPress={() => onMonth(i + 1)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={name}
                  style={[styles.chip, selected && styles.chipOn]}
                >
                  <Text style={[styles.chipText, selected && { color: colors.onAccent }]}>
                    {name.slice(0, 3)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    label: { ...t.caption, fontSize: 13, color: c.inkMuted, marginBottom: spacing.xs },
    months: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      width: '23.5%',
      paddingVertical: spacing.sm,
      alignItems: 'center',
      borderRadius: radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { ...t.body, color: c.ink },
  });
