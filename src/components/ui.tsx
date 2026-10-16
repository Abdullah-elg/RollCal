// Small shared UI kit in the SociaLink design language. Every screen builds
// from these instead of restyling raw primitives, so the look stays coherent.
//
// Where the accent goes, app-wide - keep new screens to these rules:
//   · uppercase section labels          → accent, semibold
//   · a count beside a section label    → outlined accent badge
//   · the intro line on a pushed page   → accent text + accent icon
//   · empty / placeholder copy          → muted text behind an accent rule
//   · primary action → filled accent · secondary action → outlined ink
//   · inline links and active states    → accent text
//   · destructive actions               → danger
// Form field labels stay muted on purpose, so they read as scaffolding
// rather than as section headings.

import { ReactNode, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import {
  fonts,
  Palette,
  radii,
  spacing,
  switchThumbOff,
  switchTint,
  switchTrackOff,
  switchTrackTint,
  TypeTokens,
} from '../theme';

import { AlertCircleIcon } from './icons';
import { hapticLight } from '../lib/haptics';

type ButtonProps = {
  title: string;
  onPress: () => void;
  // primary = filled accent (one per screen); secondary = outlined; danger = plain red text.
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  textStyle,
}: ButtonProps) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const textColor = isPrimary
    ? colors.onAccent
    : isDanger
    ? colors.danger
    : colors.ink;

  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
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

  // flex sizes the outer wrapper only. On the inner Pressable it would
  // override the fixed height, and a button in a row collapsed to nothing.
  const { flex, ...innerStyle } = StyleSheet.flatten(style) ?? {};

  return (
    <Animated.View style={[{ transform: [{ scale }] }, flex !== undefined ? { flex } : null]}>
      <Pressable
        onPress={() => {
          hapticLight();
          onPress();
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.button,
          isPrimary
            ? styles.buttonPrimary
            : isDanger
            ? styles.buttonDanger
            : styles.buttonSecondary,
          (disabled || loading) && { opacity: 0.5 },
          pressed && { opacity: 0.9 },
          innerStyle,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[type.button, { color: textColor }, textStyle]}
          >
            {title}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  singleLineEllipsis?: boolean;
};

export function Field({ label, style, singleLineEllipsis, ...inputProps }: FieldProps) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const inputRef = useRef<TextInput>(null);

  const isEllipsisActive = Boolean(
    singleLineEllipsis && !inputProps.multiline && !focused && inputProps.value
  );

  const handleOverlayPress = () => {
    const val = typeof inputProps.value === 'string' ? inputProps.value : '';
    setSelection({ start: val.length, end: val.length });
    setFocused(true);
    inputRef.current?.focus();
    setTimeout(() => {
      setSelection(undefined);
    }, 250);
  };

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ position: 'relative' }}>
        <TextInput
          ref={inputRef}
          placeholderTextColor={colors.inkMuted}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            setSelection(undefined);
            inputProps.onBlur?.(e);
          }}
          selection={selection}
          multiline={singleLineEllipsis ? false : inputProps.multiline}
          numberOfLines={singleLineEllipsis ? 1 : inputProps.numberOfLines}
          style={[
            styles.input,
            focused && { borderColor: colors.ink },
            isEllipsisActive && { opacity: 0 },
            style,
          ]}
          {...inputProps}
        />
        {isEllipsisActive && (
          <Pressable
            onPress={handleOverlayPress}
            style={[
              StyleSheet.absoluteFill,
              styles.input,
              styles.truncatedOverlay,
              style,
            ]}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[type.body, { color: colors.ink }]}
            >
              {inputProps.value}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// Wrapper for a scrolling form, handling the keyboard per platform.
//
// iOS: a plain view - the ScrollView's `automaticallyAdjustKeyboardInsets`
// lets the system inset and scroll the focused field into view, which moves
// nothing and animates perfectly.
// Android: that prop doesn't exist, and an edge-to-edge window doesn't shrink
// for the keyboard, so the form needs padding added under it.
export function FormScreen({
  style,
  children,
}: {
  style?: ViewStyle;
  children: ReactNode;
}) {
  if (Platform.OS === 'android') {
    return (
      <KeyboardAvoidingView style={style} behavior="padding">
        {children}
      </KeyboardAvoidingView>
    );
  }
  return <View style={style}>{children}</View>;
}

// Each platform's own switch - iOS's glass one, Android's Material one  - 
// tinted with fixed colours that never follow the theme, so flipping Dark
// mode can't recolour a switch mid-animation (which is what broke iOS).
//
// The tinting differs because the platforms colour different parts: on
// Android the thumb carries the colour, and leaving it alone is what made it
// Material blue; on iOS the thumb must be left to the system or its glass
// material mis-renders.
export function ThemedSwitch({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const handleChange = (next: boolean) => {
    hapticLight();
    onValueChange(next);
  };

  if (Platform.OS === 'android') {
    return (
      <Switch
        value={value}
        onValueChange={handleChange}
        thumbColor={value ? switchTint : switchThumbOff}
        trackColor={{ false: switchTrackOff, true: switchTrackTint }}
      />
    );
  }
  return (
    <Switch
      value={value}
      onValueChange={handleChange}
      trackColor={{ true: switchTint }}
    />
  );
}

// Sentence-case section header, normal weight, muted color (15pt).
export function SectionLabel({
  children,
  count,
  style,
}: {
  children: ReactNode;
  count?: number;
  style?: ViewStyle;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  return (
    <View style={[styles.sectionHead, style]}>
      <Text style={styles.sectionLabel}>
        {children}
        {count !== undefined && count > 0 ? ` · ${count}` : ''}
      </Text>
    </View>
  );
}

// Opening line of a screen pushed from somewhere else.
export function PageIntro({
  icon: Icon,
  children,
}: {
  icon: (props: { size?: number; color: string }) => ReactNode;
  children: ReactNode;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  return (
    <View style={styles.intro}>
      {Icon({ size: 18, color: colors.inkMuted })}
      <Text style={styles.introText}>{children}</Text>
    </View>
  );
}

// Empty-state copy: one line of muted text, no left bar or illustrations.
export function EmptyNote({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { type } = useTheme();
  return (
    <View style={[{ paddingVertical: spacing.sm }, style]}>
      <Text style={type.bodyMuted}>{children}</Text>
    </View>
  );
}

// Inline error line with warning icon so it does not rely on color alone.
export function ErrorText({ message }: { message: string | null }) {
  const { colors, type } = useTheme();
  if (!message) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: spacing.md,
      }}
    >
      <AlertCircleIcon size={16} color={colors.danger} />
      <Text style={[type.body, { color: colors.danger, flex: 1 }]}>{message}</Text>
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    button: {
      height: 48,
      borderRadius: radii.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    buttonPressed: {
      opacity: 0.85,
      transform: [{ scale: 0.98 }],
    },
    buttonPrimary: {
      backgroundColor: c.accent,
    },
    buttonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.line,
    },
    buttonDanger: {
      backgroundColor: 'transparent',
    },
    fieldWrap: {
      marginBottom: spacing.md,
    },
    fieldLabel: {
      ...t.caption,
      marginBottom: spacing.xs,
      fontSize: 13,
      color: c.inkMuted,
    },
    input: {
      ...t.body,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      height: 48,
    },
    truncatedOverlay: {
      justifyContent: 'center',
    },
    sectionHead: {
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: c.inkMuted,
    },
    intro: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    introText: {
      ...t.body,
      color: c.inkMuted,
      flexShrink: 1,
    },
  });
