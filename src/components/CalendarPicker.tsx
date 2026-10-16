import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { ArrowIcon } from './icons';
import { fonts, Palette, spacing, TypeTokens } from '../theme';

type Props = {
  value: Date;
  onChange: (next: Date) => void;
  // Days before this date render muted and don't respond to taps.
  minDate?: Date;
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Month-grid date picker in the app's own design language, so the form
// doesn't drop into a system control that ignores the theme.
export default function CalendarPicker({ value, onChange, minDate }: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());

  const goMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const firstDayOffset = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const matches = (day: number, other: Date) =>
    other.getFullYear() === viewYear &&
    other.getMonth() === viewMonth &&
    other.getDate() === day;

  const today = new Date();

  // Leading blanks so day 1 lands on its weekday column, trailing blanks to
  // complete the last week, then explicit rows of 7 - percentage-width cells
  // in a flexWrap grid can round past 100% and push Saturday onto a new row,
  // which misaligns every date after it.
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const monthTitle = new Date(viewYear, viewMonth, 1).toLocaleDateString(
    undefined,
    { month: 'long', year: 'numeric' }
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.6 }]}
          onPress={() => goMonth(-1)}
          hitSlop={8}
        >
          <ArrowIcon size={20} color={colors.ink} direction="left" />
        </Pressable>
        <Text style={styles.monthTitle}>{monthTitle}</Text>
        <Pressable
          style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.6 }]}
          onPress={() => goMonth(1)}
          hitSlop={8}
        >
          <ArrowIcon size={20} color={colors.ink} direction="right" />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <View key={`wd-${i}`} style={styles.cell}>
            <Text style={styles.weekday}>{d}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={`week-${w}`} style={styles.weekRow}>
          {week.map((day, i) => {
            if (day === null) return <View key={`blank-${i}`} style={styles.cell} />;
            const selected = matches(day, value);
            const isToday = matches(day, today);
            const beforeMin =
              !!minDate &&
              new Date(viewYear, viewMonth, day).getTime() <
                new Date(
                  minDate.getFullYear(),
                  minDate.getMonth(),
                  minDate.getDate()
                ).getTime();
            return (
              <View key={`day-${day}`} style={styles.cell}>
                <Pressable
                  disabled={beforeMin}
                  style={({ pressed }) => [
                    styles.day,
                    isToday && !selected && styles.dayToday,
                    selected && styles.daySelected,
                    beforeMin && { opacity: 0.3 },
                    pressed && !beforeMin && { opacity: 0.7 },
                  ]}
                  onPress={() => onChange(new Date(viewYear, viewMonth, day))}
                >
                  <Text
                    style={[
                      styles.dayText,
                      isToday && !selected && { color: colors.accentText },
                      selected && styles.dayTextSelected,
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      padding: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    navButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthTitle: {
      fontFamily: fonts.display,
      fontSize: 18,
      color: c.ink,
    },
    weekRow: {
      flexDirection: 'row',
    },
    cell: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 2,
    },
    weekday: {
      ...t.caption,
      fontSize: 11,
      letterSpacing: 0.5,
    },
    day: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 17,
    },
    dayToday: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accent,
    },
    daySelected: {
      backgroundColor: c.accent,
    },
    dayText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 14,
      color: c.ink,
    },
    dayTextSelected: {
      color: c.onAccent,
      fontFamily: fonts.bodySemiBold,
    },
  });
