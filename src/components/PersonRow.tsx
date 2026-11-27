// Shared people-list pieces used by the friends hub and its sub-pages, so
// all four screens render a person the same way.

import { ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Profile } from '../types';

import Avatar from './Avatar';
import { MoreIcon } from './icons';

// List of people separated by thin hairline dividers inset from the left edge.
export function PersonList({ children }: { children: ReactNode[] }) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  return (
    <View style={styles.list}>
      {children.map((child, i) => (
        <View key={i}>
          {i > 0 && <View style={styles.divider} />}
          {child}
        </View>
      ))}
    </View>
  );
}

export function PersonRow({
  person,
  subtitle,
  children,
}: {
  person: Profile;
  subtitle?: string;
  children?: ReactNode;
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  return (
    <View style={styles.row}>
      <Avatar
        userId={person.id}
        name={person.display_name}
        username={person.username}
        avatarUrl={person.avatar_url}
        size={36}
      />
      <View style={styles.rowText}>
        <Text style={type.body} numberOfLines={1}>
          {person.display_name}
        </Text>
        {subtitle ? (
          <Text style={styles.username} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : person.username ? (
          <Text style={styles.username} numberOfLines={1}>
            @{person.username}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

export function RowAction({
  label,
  onPress,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'danger' | 'muted';
}) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      <Text
        style={[
          styles.action,
          tone === 'danger' && { color: colors.danger },
          tone === 'muted' && { color: colors.inkMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Opens the actions sheet for this person (Report, Block, and Remove for
// event hosts). A filled circle so it reads as a button, not punctuation.
export function MoreAction({ name, onPress }: { name: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`More options for ${name}`}
      style={({ pressed }) => [
        // A plain icon with a full-size touch target, not a filled circle.
        {
          width: 44,
          height: 44,
          marginRight: -spacing.sm,
          borderRadius: radii.full,
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && { backgroundColor: colors.ink + '0D' },
      ]}
    >
      <MoreIcon size={20} color={colors.inkMuted} />
    </Pressable>
  );
}

// Non-interactive state label ("Friends", "Requested").
export function RowTag({ label }: { label: string }) {
  const { type } = useTheme();
  return <Text style={type.caption}>{label}</Text>;
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    list: {
      backgroundColor: 'transparent',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    username: {
      ...t.caption,
      color: c.inkMuted,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'center',
    },
    action: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginLeft: 52, // Inset past avatar
    },
  });
