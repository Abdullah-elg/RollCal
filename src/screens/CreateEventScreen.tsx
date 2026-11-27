// The form for creating an event, also used to edit one. Defaults to
// tomorrow at 7 pm for two hours, and doesn't allow moving a start into the
// past. Saving schedules the user's reminders.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimeField from '../components/DateTimeField';
import LocationPicker, { PickedLocation } from '../components/LocationPicker';
import { Button, ErrorText, Field, FormScreen, ThemedSwitch } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { nextTimeStep, TIME_STEP_MINUTES } from '../lib/dates';
import { generateInviteCode } from '../lib/inviteCode';
import { hapticSuccess } from '../lib/haptics';
import { syncEventReminders } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { fonts, Palette, radii, spacing } from '../theme';
import { EVENT_DESCRIPTION_MAX, EVENT_LOCATION_MAX, EVENT_TITLE_MAX } from '../lib/limits';
import JoinModePicker from '../components/JoinModePicker';
import { JoinMode } from '../lib/joinRequests';
import PostRulePicker from '../components/PostRulePicker';
import { PostRule } from '../lib/postRules';
import ConfirmDialog from '../components/ConfirmDialog';
import { pickAndUploadCover, pickCoverAsset, setCoverPhoto, uploadCoverAsset } from '../lib/coverPhoto';
import { ImagePickerAsset } from 'expo-image-picker';
import { CameraIcon, ChevronRightIcon } from '../components/icons';
import { removeEventFiles } from '../lib/photos';
import { signedUrl } from '../lib/signedUrls';
import { hapticLight, hapticMedium } from '../lib/haptics';
import { placeLabel } from '../lib/place';
import InfoTip from '../components/InfoTip';

type Props = NativeStackScreenProps<AppStackParamList, 'CreateEvent'>;

// Default: tomorrow at 19:00, two hours long, or prefilled date from shortcut.
function defaultStart(initialDateStr?: string): Date {
  if (initialDateStr) {
    const [y, m, d] = initialDateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d, 19, 0, 0, 0);
    const now = new Date();
    if (date.getTime() < now.getTime()) {
      if (now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d) {
        now.setHours(now.getHours() + 1, 0, 0, 0);
        return now;
      }
    }
    return date;
  }
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);
  return d;
}

export default function CreateEventScreen({ navigation, route }: Props) {
  const editEventId = route.params?.editEventId;
  const initialDate = route.params?.initialDate;
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [joinMode, setJoinMode] = useState<JoinMode>('open');
  const [photosBy, setPhotosBy] = useState<PostRule>('everyone');
  const [chatBy, setChatBy] = useState<PostRule>('everyone');
  const [billsOn, setBillsOn] = useState(true);
  // What the event had when the form opened (only changes are sent, so
  // events save as before where bills-toggle.sql hasn't run).
  const [loadedBillsOn, setLoadedBillsOn] = useState(true);
  // Description and the "Who can" choices start folded away.
  const [showMore, setShowMore] = useState(false);
  // What the event had when the form opened; only changes are sent, so
  // events save as before where post-permissions.sql hasn't run.
  // Manage event (editing): the event photo, and cancelling or deleting.
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  // New event: the picked photo, uploaded once the event exists.
  const [pendingCover, setPendingCover] = useState<ImagePickerAsset | null>(null);
  const [deleteAt, setDeleteAt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [loadedRules, setLoadedRules] = useState<{ photos: PostRule; chat: PostRule }>({
    photos: 'everyone',
    chat: 'everyone',
  });
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [startsAt, setStartsAt] = useState<Date>(() => defaultStart(initialDate));
  const [endsAt, setEndsAt] = useState<Date>(
    () => new Date(defaultStart(initialDate).getTime() + 2 * 60 * 60 * 1000)
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(!!editEventId);
  // The saved start time, so editing other fields of an already-started
  // event doesn't trip the no-past-events rule.
  const [originalStart, setOriginalStart] = useState<Date | null>(null);

  useEffect(() => {
    if (initialDate && !editEventId) {
      const s = defaultStart(initialDate);
      setStartsAt(s);
      setEndsAt(new Date(s.getTime() + 2 * 60 * 60 * 1000));
    }
  }, [initialDate, editEventId]);

  // Edit mode: prefill the form from the existing event.
  useEffect(() => {
    if (!editEventId) return;
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('*')
        .eq('id', editEventId)
        .maybeSingle();
      if (data) {
        setTitle(data.title);
        setDescription(data.description ?? '');
        setJoinMode(data.join_mode ?? (data.is_link_enabled ? 'open' : 'invite'));
        const loaded = {
          photos: (data.photos_by === 'host' ? 'host' : 'everyone') as PostRule,
          chat: (data.chat_by === 'host' ? 'host' : 'everyone') as PostRule,
        };
        setPhotosBy(loaded.photos);
        setChatBy(loaded.chat);
        setLoadedRules(loaded);
        setBillsOn(data.bills_enabled !== false);
        setLoadedBillsOn(data.bills_enabled !== false);
        setLocation(placeLabel(data.location));
        setCoords(
          data.location_lat != null && data.location_lng != null
            ? { lat: data.location_lat, lng: data.location_lng }
            : null
        );
        setStartsAt(new Date(data.starts_at));
        setEndsAt(new Date(data.ends_at));
        setOriginalStart(new Date(data.starts_at));
        setCoverPhotoId(data.cover_photo_id ?? null);
        setDeleteAt(data.delete_at ?? null);
      }
      setInitializing(false);
    })();
  }, [editEventId]);

  // The event photo's link, for the preview.
  useEffect(() => {
    if (!coverPhotoId) {
      setCoverUrl(null);
      return;
    }
    let live = true;
    (async () => {
      const { data } = await supabase
        .from('photos')
        .select('storage_path')
        .eq('id', coverPhotoId)
        .maybeSingle();
      const url = data ? await signedUrl('event-photos', data.storage_path) : null;
      if (live) setCoverUrl(url);
    })();
    return () => {
      live = false;
    };
  }, [coverPhotoId]);

  const uploadCover = async () => {
    if (!editEventId || !session?.user.id) return;
    setUploadingCover(true);
    const { photoId, error: uploadError } = await pickAndUploadCover(editEventId, session.user.id);
    setUploadingCover(false);
    if (uploadError) {
      Alert.alert('Upload failed', uploadError);
    } else if (photoId) {
      hapticLight();
      setCoverPhotoId(photoId);
    }
  };

  const pickCover = async () => {
    if (editEventId) {
      await uploadCover();
      return;
    }
    const asset = await pickCoverAsset();
    if (asset) {
      hapticLight();
      setPendingCover(asset);
    }
  };

  const removeCover = async () => {
    if (!editEventId) {
      setPendingCover(null);
      return;
    }
    hapticLight();
    const before = coverPhotoId;
    setCoverPhotoId(null);
    const { error: removeError } = await setCoverPhoto(editEventId, null);
    if (removeError) {
      setCoverPhotoId(before);
      Alert.alert('Could not update the event photo', removeError);
    }
  };

  // Before it ends: gone for everyone now. After: gone in 48 hours, so
  // people can save their photos (the host can keep it until then).
  const cancelEvent = async () => {
    if (!editEventId) return;
    setConfirm(null);
    await removeEventFiles(editEventId);
    const { error: deleteError } = await supabase.from('events').delete().eq('id', editEventId);
    if (deleteError) {
      Alert.alert('Could not cancel', deleteError.message);
      return;
    }
    syncEventReminders();
    // The event page is gone too.
    navigation.popToTop();
  };

  const deleteEvent = async () => {
    if (!editEventId) return;
    setConfirm(null);
    const { error: rpcError } = await supabase.rpc('schedule_event_deletion', { p_event: editEventId });
    if (rpcError) {
      Alert.alert('Could not delete', rpcError.message);
      return;
    }
    hapticMedium();
    navigation.goBack();
  };

  const keepEvent = async () => {
    if (!editEventId) return;
    const { error: rpcError } = await supabase.rpc('keep_event', { p_event: editEventId });
    if (rpcError) {
      Alert.alert('Could not keep the event', rpcError.message);
      return;
    }
    hapticSuccess();
    setDeleteAt(null);
  };

  // The clock, so times that pass while the form is open grey out, and a
  // start time that passes moves on to the next step (6:55 becomes 7:00 at
  // 6:56).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // Editing an event that already started leaves its start alone until
    // someone changes it.
    if (editEventId && originalStart?.getTime() === startsAt.getTime()) return;
    const earliest = nextTimeStep(now);
    if (startsAt.getTime() < earliest.getTime()) changeStart(earliest);
    // Only the clock moving should trigger this, not every edit.
  }, [now]);

  // Moving the start drags the end along if it would fall before the start.
  const changeStart = (next: Date) => {
    setStartsAt(next);
    if (endsAt.getTime() < next.getTime() + TIME_STEP_MINUTES * 60 * 1000) {
      setEndsAt(new Date(next.getTime() + 2 * 60 * 60 * 1000));
    }
  };

  const submit = async () => {
    // Editing an event that already started is fine as long as the start
    // isn't being moved into the past.
    const startChanged = originalStart?.getTime() !== startsAt.getTime();
    if ((!editEventId || startChanged) && startsAt.getTime() < Date.now()) {
      setError("The event can't start in the past.");
      return;
    }
    if (endsAt <= startsAt) {
      setError('The end time must be after the start time.');
      return;
    }
    setError(null);
    setBusy(true);

    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      location_lat: coords?.lat ?? null,
      location_lng: coords?.lng ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      join_mode: joinMode,
      ...(photosBy !== loadedRules.photos ? { photos_by: photosBy } : {}),
      ...(chatBy !== loadedRules.chat ? { chat_by: chatBy } : {}),
      ...(billsOn !== loadedBillsOn ? { bills_enabled: billsOn } : {}),
    };

    if (editEventId) {
      const { error: updateError } = await supabase
        .from('events')
        .update(fields)
        .eq('id', editEventId);
      setBusy(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      hapticSuccess();
      syncEventReminders();
      // Back to the detail screen, which reloads on focus.
      navigation.goBack();
      return;
    }

    const { data, error: insertError } = await supabase
      .from('events')
      .insert({
        creator_id: session!.user.id,
        ...fields,
        invite_code: generateInviteCode(),
        is_link_enabled: joinMode !== 'invite',
      })
      .select()
      .single();
    if (insertError || !data) {
      setBusy(false);
      setError(insertError?.message ?? 'Could not create the event.');
      return;
    }
    if (pendingCover) {
      const { error: coverError } = await uploadCoverAsset(data.id, session!.user.id, pendingCover);
      if (coverError) {
        Alert.alert(
          'Event created',
          "The photo didn't upload. You can add it from Manage event (the pencil next to the title)."
        );
      }
    }
    setBusy(false);
    hapticSuccess();
    // Schedule reminders for the new event per the user's settings.
    syncEventReminders();
    // Straight to the new event; back from there goes Home, not the form.
    navigation.replace('EventDetail', { eventId: data.id });
  };

  const optionsSummary = [
    joinMode === 'open'
      ? 'Anyone with the link can join'
      : joinMode === 'approval'
        ? 'You approve who joins'
        : 'Only people you invite',
    photosBy === 'everyone' && chatBy === 'everyone'
      ? 'everyone adds photos and chats'
      : photosBy === chatBy
        ? 'only you add photos and chat'
        : photosBy === 'host'
          ? 'only you add photos'
          : 'only you chat',
    ...(billsOn ? [] : ['no bill splitting']),
  ].join(' · ');
  const hasCover = editEventId ? !!coverPhotoId : !!pendingCover;
  const coverSrc = editEventId ? coverUrl : pendingCover?.uri ?? null;

  if (initializing) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <FormScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* The event photo, shaped like it shows at the top of the event. */}
        <Pressable
          onPress={pickCover}
          disabled={uploadingCover}
          accessibilityRole="button"
          accessibilityLabel={hasCover ? 'Change event photo' : 'Add event photo'}
          style={({ pressed }) => [styles.cover, pressed && { opacity: 0.85 }]}
        >
          {coverSrc ? (
            <Image source={{ uri: coverSrc }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : hasCover ? null : (
            <View style={styles.coverEmpty}>
              <CameraIcon size={22} color={colors.inkMuted} />
              <Text style={styles.coverEmptyTitle}>Add event photo</Text>
              <Text style={styles.coverCaption}>Optional</Text>
            </View>
          )}
          {uploadingCover && (
            <View style={styles.coverBusy}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
          {hasCover && !uploadingCover && (
            <View style={styles.coverActions}>
              <Pressable onPress={pickCover} hitSlop={6} accessibilityRole="button" style={styles.coverChip}>
                <Text style={styles.coverChipText}>Change</Text>
              </Pressable>
              <Pressable onPress={removeCover} hitSlop={6} accessibilityRole="button" style={styles.coverChip}>
                <Text style={styles.coverChipText}>Remove</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
        <View style={styles.fieldBlock}>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Rooftop dinner"
            maxLength={EVENT_TITLE_MAX}
          />
        </View>
        <View style={[styles.locationRow, styles.fieldBlock]}>
          <View style={{ flex: 1 }}>
            <Field
              label={coords ? 'Location · pin set' : 'Location'}
              value={location}
              onChangeText={(v) => {
                setLocation(v);
                // Hand-edited text no longer matches the pin; drop it.
                if (coords) setCoords(null);
              }}
              placeholder="Where is it?"
              maxLength={EVENT_LOCATION_MAX}
              singleLineEllipsis
              returnKeyType="done"
            />
          </View>
          <Button
            title={coords ? 'Move pin' : 'Pin'}
            variant="secondary"
            onPress={() => setShowMap(true)}
            style={styles.pinButton}
          />
        </View>
        <DateTimeField
          label="Starts"
          value={startsAt}
          onChange={changeStart}
          minDate={now}
        />
        <DateTimeField
          label="Ends"
          value={endsAt}
          onChange={setEndsAt}
          // At least one step after the start; the same time is greyed out.
          minDate={new Date(startsAt.getTime() + TIME_STEP_MINUTES * 60 * 1000)}
        />
        {/* The extras stay behind one row that says what they're set to, so
            nobody has to decide anything to make or edit an event. */}
        {(
          <Pressable
            onPress={() => setShowMore((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showMore }}
            style={({ pressed }) => [styles.moreRow, showMore && styles.moreRowOpen, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.moreTitle}>More options</Text>
              {!showMore && <Text style={styles.coverCaption}>{optionsSummary}</Text>}
            </View>
            <View style={{ transform: [{ rotate: showMore ? '270deg' : '90deg' }] }}>
              <ChevronRightIcon size={18} color={colors.inkMuted} />
            </View>
          </Pressable>
        )}
        {showMore && (
          <>
        <View style={styles.fieldBlock}>
        <Field
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="What should people know?"
          multiline
          numberOfLines={3}
          style={styles.multiline}
          maxLength={EVENT_DESCRIPTION_MAX}
        />
        {description.length > EVENT_DESCRIPTION_MAX * 0.8 && (
          <Text style={styles.counter}>
            {description.length} / {EVENT_DESCRIPTION_MAX}
          </Text>
        )}
        </View>
        <Text style={styles.sectionLabel}>Who can join</Text>
        <View style={styles.block}>
          <JoinModePicker value={joinMode} onChange={setJoinMode} />
        </View>
        <Text style={styles.sectionLabel}>Who can add photos</Text>
        <View style={styles.block}>
          <PostRulePicker kind="photos" value={photosBy} onChange={setPhotosBy} />
        </View>
        <Text style={styles.sectionLabel}>Who can chat</Text>
        <View style={styles.block}>
          <PostRulePicker kind="chat" value={chatBy} onChange={setChatBy} />
        </View>
        <Text style={styles.sectionLabel}>Bills</Text>
        <View style={[styles.block, styles.switchRow]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={styles.moreTitle}>Split bills</Text>
            <InfoTip
              title="Split bills"
              text="Lets people in the event split costs and pay each other back. Turning it off stops new bills; ones already added stay."
            />
          </View>
          <ThemedSwitch value={billsOn} onValueChange={setBillsOn} />
        </View>
          </>
        )}
        <ErrorText message={error} />
        <Button
          title={editEventId ? 'Save changes' : 'Create event'}
          onPress={submit}
          loading={busy}
          disabled={!title.trim()}
        />
        {editEventId && (
          <View style={styles.dangerSection}>
            {deleteAt ? (
              <Pressable onPress={keepEvent} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.dangerText, { color: colors.accentText }]}>Keep event</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setConfirm(endsAt.getTime() <= Date.now() ? 'delete' : 'cancel')}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.dangerText}>
                  {endsAt.getTime() <= Date.now() ? 'Delete event' : 'Cancel event'}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirm === 'cancel'}
        title="Cancel this event?"
        message="This deletes the event for everyone, RSVPs included. It can't be undone."
        confirmLabel="Cancel event"
        cancelLabel="Keep event"
        destructive
        onConfirm={cancelEvent}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'delete'}
        title="Delete this event?"
        message="Everything in it will be lost: photos, videos, chat, bills and RSVPs. Everyone in the event gets a notice to save what they want, and it's deleted for good in 48 hours."
        confirmLabel="Delete event"
        cancelLabel="Keep event"
        destructive
        onConfirm={deleteEvent}
        onCancel={() => setConfirm(null)}
      />

      <LocationPicker
        visible={showMap}
        initial={coords}
        onClose={() => setShowMap(false)}
        onPick={(picked: PickedLocation) => {
          setCoords({ lat: picked.lat, lng: picked.lng });
          // A full street address can run long; keep it within the limit.
          setLocation(picked.label.slice(0, EVENT_LOCATION_MAX));
          setShowMap(false);
        }}
      />
    </FormScreen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    multiline: {
      height: 88,
      paddingTop: spacing.sm,
      textAlignVertical: 'top',
    },
    sectionLabel: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: c.inkMuted,
      marginBottom: spacing.xs,
    },
    counter: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: c.inkMuted,
      textAlign: 'right',
      marginTop: -spacing.sm,
      marginBottom: spacing.sm,
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
    },
    // One gap between every block on the form. Fields already leave
    // spacing.md under themselves, so they add the rest.
    block: { marginBottom: spacing.lg },
    fieldBlock: { marginBottom: spacing.lg - spacing.md },
    cover: {
      height: 180,
      borderRadius: radii.card,
      overflow: 'hidden',
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      marginBottom: spacing.lg,
      justifyContent: 'center',
      alignItems: 'center',
    },
    moreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.card,
      marginBottom: spacing.lg,
    },
    moreRowOpen: { borderColor: c.ink },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.card,
    },
    moreTitle: { fontFamily: fonts.body, fontSize: 16, color: c.ink },
    coverEmpty: { alignItems: 'center', gap: spacing.xs },
    coverEmptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: c.ink, marginTop: spacing.xs },
    coverBusy: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    coverActions: {
      position: 'absolute',
      right: spacing.sm,
      bottom: spacing.sm,
      flexDirection: 'row',
      gap: spacing.sm,
    },
    coverChip: {
      backgroundColor: 'rgba(0,0,0,0.7)',
      borderRadius: radii.control,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      minHeight: 36,
      justifyContent: 'center',
    },
    coverChipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' },
    coverCaption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.inkMuted },
    dangerSection: {
      marginTop: spacing.xl,
    },
    dangerText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 16,
      color: c.danger,
      textAlign: 'center',
      paddingVertical: spacing.sm,
    },
    pinButton: {
      // Lines up with the input, which sits under the field's label.
      marginBottom: spacing.md,
      paddingHorizontal: spacing.md,
    },
  });
