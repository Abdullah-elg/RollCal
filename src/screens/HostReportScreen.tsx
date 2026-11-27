// A photo or video someone reported to you as the event's host: the photo,
// who uploaded it, the reason and any details. Never who reported it. Keep
// it or delete it; the server checks you're the host (host-reports.sql).

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import ConfirmDialog from '../components/ConfirmDialog';
import { RollVideo } from '../components/EventAlbum';
import { Button, EmptyNote, ErrorText, SectionLabel } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { hapticLight } from '../lib/haptics';
import { HostReportView, loadHostReport, reasonLabel, resolveHostReport } from '../lib/hostReports';
import { useSignedUrl } from '../lib/signedUrls';
import { AppStackParamList } from '../navigation/types';
import { Palette, radii, spacing, TypeTokens } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'HostReport'>;

export default function HostReportScreen({ navigation, route }: Props) {
  const { reportId } = route.params;
  const { colors, type } = useTheme();
  const { refresh: refreshUnread } = useUnread();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);

  // undefined: loading; null: not yours or gone.
  const [view, setView] = useState<HostReportView | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<'keep' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setView(await loadHostReport(reportId));
    } catch {
      setLoadFailed(true);
    }
  }, [reportId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const isVideo = view?.report.kind === 'video';
  const noun = isVideo ? 'video' : 'photo';
  const photoUrl = useSignedUrl('event-photos', !isVideo ? view?.storagePath : null);

  const decide = async (decision: 'keep' | 'delete') => {
    if (!view || busy) return;
    setConfirmDelete(false);
    setBusy(decision);
    setError(null);
    const result = await resolveHostReport(view, decision);
    setBusy(null);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    hapticLight();
    refreshUnread();
    setView({
      ...view,
      storagePath: result.decision === 'deleted' ? null : view.storagePath,
      report: { ...view.report, decision: result.decision, decided_at: new Date().toISOString() },
    });
  };

  // It was already deleted (by its uploader, or you from the album): clear
  // the report so it stops waiting, then leave.
  const closeGone = async () => {
    if (view && !view.report.decision) await resolveHostReport(view, 'delete');
    refreshUnread();
    navigation.goBack();
  };

  if (view === undefined) {
    return (
      <View style={[styles.screen, styles.center]}>
        {loadFailed ? (
          <View style={{ gap: spacing.md, alignItems: 'center' }}>
            <Text style={type.bodyMuted}>Couldn’t load this report.</Text>
            <Button title="Try again" variant="secondary" onPress={load} />
          </View>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  if (view === null) {
    return (
      <View style={[styles.screen, styles.content]}>
        <EmptyNote>
          This report isn’t available. Only the event’s host can review it, and it may have been removed.
        </EmptyNote>
        <Button title="Done" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const { report } = view;
  const decided = report.decision;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h2}>{view.eventTitle}</Text>
      <Text style={[type.bodyMuted, { marginTop: spacing.xs }]}>
        Someone reported this {noun} to you. We don’t share who.
      </Text>

      <View style={styles.media}>
        {view.storagePath ? (
          isVideo ? (
            <RollVideo storagePath={view.storagePath} />
          ) : photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={`The reported ${noun}`}
            />
          ) : (
            <ActivityIndicator color={colors.accent} />
          )
        ) : (
          <Text style={type.bodyMuted}>This {noun} has been deleted.</Text>
        )}
      </View>

      <SectionLabel style={styles.label}>Uploaded by</SectionLabel>
      <Text style={type.body}>{view.uploaderName ?? 'A deleted account'}</Text>

      <SectionLabel style={styles.label}>Reason</SectionLabel>
      <Text style={type.body}>{reasonLabel(report.reason)}</Text>
      {report.details ? (
        <Text style={[type.body, styles.details]}>“{report.details}”</Text>
      ) : null}
      {report.also_support && (
        <Text style={[type.caption, { marginTop: spacing.sm }]}>
          Because of this reason, RollCal support was told too.
        </Text>
      )}

      <View style={styles.actions}>
        {decided ? (
          <>
            <Text style={type.body}>
              {decided === 'deleted'
                ? `The ${noun} was deleted.`
                : `You kept this ${noun}.`}
            </Text>
            <Button title="Done" onPress={() => navigation.goBack()} />
          </>
        ) : !view.storagePath ? (
          <>
            <Text style={type.body}>This {noun} was already deleted. Nothing more to do.</Text>
            <Button title="Done" onPress={closeGone} />
          </>
        ) : (
          <>
            <ErrorText message={error} />
            <View style={styles.buttonRow}>
              <Button
                title={`Keep ${noun}`}
                variant="secondary"
                onPress={() => decide('keep')}
                loading={busy === 'keep'}
                disabled={busy !== null}
                style={{ flex: 1 }}
              />
              <Button
                title={`Delete ${noun}`}
                variant="danger"
                onPress={() => setConfirmDelete(true)}
                loading={busy === 'delete'}
                disabled={busy !== null}
                style={{ flex: 1 }}
              />
            </View>
          </>
        )}
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title={isVideo ? 'Delete this video?' : 'Delete this photo?'}
        message="It's removed for everyone in the event."
        confirmLabel="Delete"
        destructive
        onConfirm={() => decide('delete')}
        onCancel={() => setConfirmDelete(false)}
      />
    </ScrollView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    center: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
    media: {
      marginTop: spacing.md,
      aspectRatio: 4 / 5,
      borderRadius: radii.card,
      overflow: 'hidden',
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    label: { marginTop: spacing.md },
    details: { ...t.body, color: c.ink, marginTop: spacing.xs },
    actions: { marginTop: spacing.lg, gap: spacing.md },
    buttonRow: { flexDirection: 'row', gap: spacing.sm },
  });
