// All of an event's photos and videos: the "+N more" tile on the event page
// opens it, and so does a Memory on the Profile tab, which also floats a
// "Go to event" button at the bottom. It's the same album as on the event
// page (adding, saving, the viewer, reports), just with nothing else around it.

import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EventAlbum from '../components/EventAlbum';
import { Button, EmptyNote } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { setCoverPhoto } from '../lib/coverPhoto';
import { eventEnded } from '../lib/rsvpLabels';
import { hapticLight } from '../lib/haptics';
import { syncEventReminders } from '../lib/notifications';
import { reopenRoll } from '../lib/roll';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { Palette, spacing } from '../theme';
import { Event } from '../types';

type Props = NativeStackScreenProps<AppStackParamList, 'EventPhotos'>;

export default function EventPhotosScreen({ navigation, route }: Props) {
  const { eventId, fromMemories } = route.params;
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  // undefined while loading, null if it's gone or not yours to see.
  const [event, setEvent] = useState<Event | null | undefined>(undefined);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const onPhotosChange = useCallback((list: unknown[]) => setPhotoCount(list.length), []);

  const load = useCallback(async () => {
    const { data } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    setEvent((data as Event | null) ?? null);
    setRefreshSeq((n) => n + 1);
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useLayoutEffect(() => {
    navigation.setOptions({ title: event?.title ?? '' });
  }, [navigation, event?.title]);

  if (event === undefined) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (event === null || !session) {
    return (
      <View style={[styles.screen, { padding: spacing.lg }]}>
        <EmptyNote>This event isn’t available any more.</EmptyNote>
      </View>
    );
  }

  const isLeader = event.creator_id === session.user.id;
  // Same rule as the event page: a recap once it's over and has photos.
  const canRecap = eventEnded(event.ends_at) && photoCount > 0;

  const handleSetCoverPhoto = async (photoId: string | null) => {
    hapticLight();
    setEvent({ ...event, cover_photo_id: photoId });
    const { error } = await setCoverPhoto(event.id, photoId);
    if (error) Alert.alert('Could not update the event photo', error);
  };

  const reopen = async () => {
    hapticLight();
    const { until, error } = await reopenRoll(event.id);
    if (error) {
      Alert.alert('Could not reopen adding photos', error);
      return;
    }
    setEvent({ ...event, uploads_closed: false, uploads_reopened_until: until });
    syncEventReminders();
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{
          // The same frame as on the event page: the grid reaches the edges.
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: insets.bottom + spacing.xl,
        }}
      >
        {/* The ways out sit above the photos, so they never cover them:
            the recap once the event is over, and (from Memories) the event. */}
        {canRecap || fromMemories ? (
          <View style={styles.topActions}>
            {canRecap ? (
              <Button
                title="Share a recap"
                onPress={() => navigation.navigate('Recap', { eventId })}
              />
            ) : null}
            {fromMemories ? (
              <Button
                title="Go to event"
                variant="secondary"
                onPress={() => navigation.navigate('EventDetail', { eventId })}
              />
            ) : null}
          </View>
        ) : null}
        <EventAlbum
          event={event}
          onPhotosChange={onPhotosChange}
          isLeader={isLeader}
          userId={session.user.id}
          refreshSeq={refreshSeq}
          uploadsClosedOverride={event.uploads_closed}
          onReopenRoll={reopen}
          coverPhotoId={event.cover_photo_id}
          onSetCoverPhoto={handleSetCoverPhoto}
        />
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.paper },
    center: { alignItems: 'center', justifyContent: 'center' },
    topActions: { alignSelf: 'stretch', gap: spacing.sm, marginBottom: spacing.lg },
  });
