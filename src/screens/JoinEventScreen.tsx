// Join an event with a code, from a scan, a pasted code or a join link.
// Events aren't publicly readable, so the lookup goes through the
// get_event_by_code function. Joining records an RSVP and sets reminders.

import * as Clipboard from '../lib/clipboard';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CopyIcon, TicketIcon } from '../components/icons';
import QRScannerModal from '../components/QRScannerModal';
import RsvpSelector from '../components/RsvpSelector';
import {
  Button,
  ErrorText,
  FormScreen,
  PageIntro,
  SectionLabel,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { formatSpan } from '../lib/dates';
import { hapticLight } from '../lib/haptics';
import { syncEventReminders } from '../lib/notifications';
import { cancelJoinRequest, hasPendingRequest, joinEvent } from '../lib/joinRequests';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import { Event, RsvpStatus } from '../types';

type Props = NativeStackScreenProps<AppStackParamList, 'JoinEvent'>;

export default function JoinEventScreen({ navigation, route }: Props) {
  const { session } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const linkedCode = route.params?.code?.toUpperCase() ?? null;
  const [code, setCode] = useState(linkedCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Event | null>(null);
  const [hostName, setHostName] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // On an approval event: they've asked and are waiting for the host.
  const [requested, setRequested] = useState(false);
  const [showScanner, setShowScanner] = useState(Boolean(route.params?.openScanner));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (route.params?.openScanner) {
      setShowScanner(true);
    }
  }, [route.params?.openScanner]);

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) return;
      hapticLight();
      const match = text.match(/[A-Za-z0-9]{8}/);
      const extracted = (match ? match[0] : text.trim().slice(0, 8)).toUpperCase();
      if (extracted) {
        setCode(extracted);
        if (extracted.length === 8) {
          find(extracted);
        }
      }
    } catch {
      // ignore
    }
  };

  // Events aren't publicly readable, so the lookup goes through the
  // get_event_by_code RPC: it only returns the event if the code matches,
  // the link is enabled, and this user isn't banned.
  const find = async (rawCode?: string) => {
    setError(null);
    setPreview(null);
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('get_event_by_code', {
      code: (rawCode ?? code).trim().toUpperCase(),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const event: Event | undefined = data?.[0];
    if (!event) {
      setError('No event found for that code. It may have been turned off by the host.');
      return;
    }
    setPreview(event);
    setRequested(
      event.join_mode === 'approval' && !!session
        ? await hasPendingRequest(event.id, session.user.id)
        : false
    );
    const { data: host } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', event.creator_id)
      .maybeSingle();
    setHostName(host?.display_name ?? null);
  };

  // Arrived via an invite link - look the code up immediately.
  useEffect(() => {
    if (linkedCode) find(linkedCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedCode]);

  const choose = async (status: RsvpStatus) => {
    if (!preview || !session) return;
    hapticLight();
    // Saying no to an event you'd have to ask to join: nothing to send.
    if (status === 'not_going' && preview.join_mode === 'approval') {
      navigation.goBack();
      return;
    }
    setJoining(true);
    const res = await joinEvent(preview.id, status);
    setJoining(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    if (res.result === 'requested') {
      setRequested(true);
      return;
    }
    syncEventReminders();
    // Into the event proper; back goes Home, not this form.
    navigation.replace('EventDetail', { eventId: preview.id });
  };

  return (
    <FormScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <PageIntro icon={TicketIcon}>
          Got a code from a friend? Enter it to see the event and RSVP.
        </PageIntro>
        <View style={styles.codeFieldWrap}>
          <Text style={styles.codeFieldLabel}>Invite code</Text>
          <View style={[styles.inputBox, isFocused && styles.inputBoxFocused]}>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              placeholder="ABCD1234"
              placeholderTextColor={colors.inkMuted}
              style={styles.codeInput}
            />
            <Pressable
              onPress={handlePaste}
              hitSlop={8}
              style={({ pressed }) => [
                styles.inlinePasteButton,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Paste invite code"
            >
              <CopyIcon size={14} color={colors.accent} />
              <Text style={styles.inlinePasteText}>Paste</Text>
            </Pressable>
          </View>
        </View>
        <ErrorText message={error} />
        {!preview && (
          <View style={{ gap: spacing.sm }}>
            <Button
              title="Find event"
              onPress={() => find()}
              loading={busy}
              disabled={code.trim().length < 8}
            />
            <Button
              title="Scan QR code"
              variant="secondary"
              onPress={() => setShowScanner(true)}
            />
          </View>
        )}

        {preview && (
          <>
            <View style={styles.previewCard}>
              <Text style={type.h2}>{preview.title}</Text>
              <Text style={[type.body, { marginTop: spacing.sm }]}>
                {formatSpan(preview.starts_at, preview.ends_at)}
              </Text>
              {preview.location ? (
                <Text style={type.bodyMuted}>{preview.location}</Text>
              ) : null}
              {hostName ? (
                <Text style={[type.caption, { marginTop: spacing.sm }]}>
                  Hosted by {hostName}
                </Text>
              ) : null}
              {preview.description ? (
                <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>
                  {preview.description}
                </Text>
              ) : null}
            </View>
            {requested ? (
              <View style={styles.requestedCard}>
                <Text style={type.h3}>Request sent</Text>
                <Text style={[type.bodyMuted, { marginTop: spacing.xs }]}>
                  The host approves everyone who joins this event. You’ll get a
                  notification when they let you in.
                </Text>
                <Pressable
                  onPress={async () => {
                    if (!session) return;
                    await cancelJoinRequest(preview.id, session.user.id);
                    setRequested(false);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={({ pressed }) => [{ marginTop: spacing.md }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.cancelRequest}>Cancel request</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <SectionLabel>Are you in?</SectionLabel>
                {preview.join_mode === 'approval' && (
                  <Text style={[type.caption, { marginBottom: spacing.sm }]}>
                    The host approves everyone who joins. Pick an answer to ask.
                  </Text>
                )}
                <RsvpSelector value={null} onSelect={choose} disabled={joining} />
              </>
            )}
          </>
        )}
      </ScrollView>

      <QRScannerModal
        visible={showScanner}
        onScanned={(scannedCode) => {
          setShowScanner(false);
          setCode(scannedCode);
          find(scannedCode);
        }}
        onClose={() => setShowScanner(false)}
      />
    </FormScreen>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    codeFieldWrap: {
      marginBottom: spacing.md,
    },
    codeFieldLabel: {
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: c.inkMuted,
      marginBottom: spacing.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    inputBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radii.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
      height: 54,
    },
    inputBoxFocused: {
      borderColor: c.ink,
    },
    codeInput: {
      flex: 1,
      fontFamily: fonts.headingMedium,
      fontSize: 20,
      letterSpacing: 4,
      color: c.ink,
      paddingVertical: 0,
    },
    inlinePasteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.sm,
      backgroundColor: c.accent + '18',
    },
    inlinePasteText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: c.accent,
    },
    previewCard: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    requestedCard: {
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: 16,
      padding: spacing.md,
    },
    cancelRequest: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.danger,
    },
  });
