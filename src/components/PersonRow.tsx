// Shared people-list pieces used by the friends hub and its sub-pages, so
// all four screens render a person the same way.

import { ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fonts, Palette, spacing, TypeTokens } from '../theme';
import { Profile } from '../types';

import Avatar from './Avatar';

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
