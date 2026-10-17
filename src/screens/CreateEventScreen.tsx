import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import DateTimeField from '../components/DateTimeField';
import LocationPicker, { PickedLocation } from '../components/LocationPicker';
import { Button, ErrorText, Field, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { generateInviteCode } from '../lib/inviteCode';
import { hapticSuccess } from '../lib/haptics';
import { syncEventReminders } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { Palette, spacing } from '../theme';

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
        setLocation(data.location ?? '');
        setCoords(
          data.location_lat != null && data.location_lng != null
            ? { lat: data.location_lat, lng: data.location_lng }
            : null
        );
        setStartsAt(new Date(data.starts_at));
        setEndsAt(new Date(data.ends_at));
        setOriginalStart(new Date(data.starts_at));
      }
      setInitializing(false);
    })();
  }, [editEventId]);

  // Moving the start drags the end along if it would fall before the start.
  const changeStart = (next: Date) => {
    setStartsAt(next);
    if (endsAt <= next) {
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
        is_link_enabled: true,
      })
      .select()
      .single();
    setBusy(false);
    if (insertError || !data) {
      setError(insertError?.message ?? 'Could not create the event.');
      return;
    }
    hapticSuccess();
    // Schedule reminders for the new event per the user's settings.
    syncEventReminders();
    // Straight to the new event; back from there goes Home, not the form.
    navigation.replace('EventDetail', { eventId: data.id });
  };

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
        <Field
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Rooftop dinner"
          maxLength={120}
        />
        <View style={styles.locationRow}>
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
              singleLineEllipsis
              returnKeyType="done"
              maxLength={300}
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
          minDate={new Date()}
        />
        <DateTimeField
          label="Ends"
          value={endsAt}
          onChange={setEndsAt}
          minDate={startsAt}
        />
        <Field
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="What should people know?"
          multiline
          numberOfLines={3}
          style={styles.multiline}
          maxLength={2000}
        />
        <ErrorText message={error} />
        <Button
          title={editEventId ? 'Save changes' : 'Create event'}
          onPress={submit}
          loading={busy}
          disabled={!title.trim()}
        />
      </ScrollView>

      <LocationPicker
        visible={showMap}
        initial={coords}
        onClose={() => setShowMap(false)}
        onPick={(picked: PickedLocation) => {
          setCoords({ lat: picked.lat, lng: picked.lng });
          setLocation(picked.label);
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
    locationRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
    },
    pinButton: {
      // Lines up with the input, which sits under the field's label.
      marginBottom: spacing.md,
      paddingHorizontal: spacing.md,
    },
  });
