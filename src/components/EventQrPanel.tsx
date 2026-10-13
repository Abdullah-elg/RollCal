import * as Clipboard from '../lib/clipboard';
import * as ExpoLinking from 'expo-linking';
import { useMemo, useState } from 'react';
import {
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '../context/ThemeContext';
import { formatSpan } from '../lib/dates';
import { hapticLight } from '../lib/haptics';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { CheckIcon, CopyIcon } from './icons';
import { Button } from './ui';

type Props = {
  event: {
    id: string;
    title: string;
    invite_code: string;
    starts_at: string;
    ends_at: string;
    location?: string | null;
  };
};

export default function EventQrPanel({ event }: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [copied, setCopied] = useState(false);

  // Deep link URL encoded into the QR code
  const appUrl = ExpoLinking.createURL(`join/${event.invite_code}`);
  const webUrl =
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/join` +
    `?code=${event.invite_code}&to=${encodeURIComponent(appUrl)}`;

  const copyCode = async () => {
    try {
      await Clipboard.setStringAsync(event.invite_code);
      hapticLight();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const shareLink = () => {
    Share.share({
      message:
        `Join "${event.title}" on SociaLink!\n` +
        `${formatSpan(event.starts_at, event.ends_at)}` +
        (event.location ? `\n${event.location}` : '') +
        `\n\nTap to join: ${webUrl}` +
        `\n\nOr open the app, tap "Join with code" and enter: ${event.invite_code}`,
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.meta}>
        {formatSpan(event.starts_at, event.ends_at)}
      </Text>
      {event.location ? (
        <Text style={styles.location} numberOfLines={1}>
          {event.location}
        </Text>
      ) : null}

      <View style={styles.qrContainer}>
        <View style={styles.qrFrame}>
          <QRCode
            value={webUrl}
            size={200}
            color={colors.ink}
            backgroundColor={colors.paper}
          />
        </View>
      </View>

      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>Invite code</Text>
        <View style={styles.codeContentRow}>
          <Text style={styles.codeValue}>{event.invite_code}</Text>
          <Pressable
            onPress={copyCode}
            hitSlop={12}
            style={({ pressed }) => [
              styles.copyIconBtn,
              pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Copy invite code"
          >
            {copied ? (
              <CheckIcon size={18} color={colors.accent} />
            ) : (
              <CopyIcon size={18} color={colors.inkMuted} />
            )}
          </Pressable>
        </View>
      </View>

      <Text style={styles.hint}>
        Scan with any phone camera app or SociaLink to open and join this event.
      </Text>

      <Button
        title="Share invite link"
        variant="secondary"
        onPress={shareLink}
        style={{ width: '100%', marginTop: spacing.sm }}
      />
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    title: {
      ...t.h2,
      color: c.ink,
      textAlign: 'center',
      marginBottom: spacing.xs,
    },
    meta: {
      ...t.bodyMuted,
      fontSize: 14,
      textAlign: 'center',
    },
    location: {
      ...t.caption,
      color: c.inkMuted,
      textAlign: 'center',
      marginTop: 2,
    },
    qrContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: spacing.lg,
    },
    qrFrame: {
      padding: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    codeBox: {
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: radii.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      marginBottom: spacing.md,
      minWidth: 220,
    },
    codeContentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      marginTop: 2,
    },
    copyIconBtn: {
      padding: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    codeLabel: {
      ...t.caption,
      fontSize: 12,
      color: c.inkMuted,
    },
    codeValue: {
      ...t.h3,
      letterSpacing: 4,
      fontFamily: fonts.heading,
      color: c.ink,
    },
    hint: {
      ...t.caption,
      textAlign: 'center',
      color: c.inkMuted,
      marginBottom: spacing.md,
      lineHeight: 18,
      paddingHorizontal: spacing.lg,
    },
  });
