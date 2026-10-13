import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { hapticLight, hapticMedium } from '../lib/haptics';
import { fonts, Palette, radii, spacing } from '../theme';
import { RsvpStatus } from '../types';

const OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_going', label: "Can't go" },
];

type Props = {
  value: RsvpStatus | null;
  onSelect: (status: RsvpStatus) => void;
  disabled?: boolean;
};

function RsvpOption({
  opt,
  selected,
  disabled,
  onPress,
  styles,
  colors,
}: {
  opt: { value: RsvpStatus; label: string };
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  styles: any;
  colors: Palette;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const fillAnim = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: selected ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [selected, fillAnim]);

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.96,
      friction: 9,
      tension: 120,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 9,
      tension: 120,
      useNativeDriver: true,
    }).start();
  };

  const backgroundColor = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.card, colors.accent],
  });

  const borderColor = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.line, colors.accent],
  });

  const textColor = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.ink, colors.onAccent],
  });

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <Pressable
        disabled={disabled}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => {
          if (opt.value === 'going') {
            hapticMedium();
          } else {
            hapticLight();
          }
          onPress();
        }}
        style={{ flex: 1 }}
      >
        <Animated.View
          style={[
            styles.option,
            { backgroundColor, borderColor },
            disabled && { opacity: 0.6 },
          ]}
        >
          <Animated.Text style={[styles.label, { color: textColor }]}>
            {opt.label}
          </Animated.Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export default function RsvpSelector({ value, onSelect, disabled }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      {OPTIONS.map((opt) => (
        <RsvpOption
          key={opt.value}
          opt={opt}
          selected={value === opt.value}
          disabled={disabled}
          onPress={() => onSelect(opt.value)}
          styles={styles}
          colors={colors}
        />
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    option: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    optionSelected: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    label: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: c.ink,
    },
    labelSelected: {
      color: c.onAccent,
    },
  });
