// The Calendar tab. A month grid and a day view of events the user created,
// RSVP'd to or accepted an invite to. An event that runs past midnight
// shows on each day it touches. Days are kept in the phone's local time.

import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { MarkedDates } from 'react-native-calendars/src/types';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowIcon } from '../components/icons';
import { Button, SectionLabel } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { formatDay, formatTime } from '../lib/dates';
import { hapticLight } from '../lib/haptics';
import { loadPendingInvitations } from '../lib/invitations';
import {
  notifyChatMessages,
  notifyEventInvitations,
  syncEventReminders,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { TabScreenProps } from '../navigation/types';
import {
  tabBarHeight,
  fonts,
  Palette,
  radii,
  spacing,
  TypeTokens,
} from '../theme';
import { Event } from '../types';
import { placeLabel } from '../lib/place';

type Props = TabScreenProps<'CalendarTab'>;
type ViewMode = 'month' | 'day';

// Calendar days are keyed "YYYY-MM-DD" in the phone's local time zone  - 
// toISOString() would use UTC and push late-evening events onto the next day.
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Every local day an event touches, so a late-night event that runs past
// midnight shows on both days. Capped so a bad end date can't flood the grid.
function daysTouched(event: Event): string[] {
  const keys: string[] = [];
  const cursor = new Date(event.starts_at);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(event.ends_at);
  while (cursor <= end && keys.length < 31) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys.length > 0 ? keys : [dayKey(new Date(event.starts_at))];
}

export default function CalendarScreen({ navigation }: Props) {
  const { session } = useAuth();
  const userId = session!.user.id;
  const { colors, type, mode } = useTheme();
  const { unreadChats, refresh: refreshUnread } = useUnread();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const insets = useSafeAreaInsets();
  const bottomInset =
    Platform.OS === 'ios'
      ? insets.bottom + tabBarHeight
      : 0;

  const [events, setEvents] = useState<Event[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date()));
  const [refreshing, setRefreshing] = useState(false);

  const todayKey = dayKey(new Date());

  const shiftDay = (days: number) => {
    const [y, m, d] = selectedDay.split('-').map(Number);
    const next = new Date(y, m - 1, d + days);
    setSelectedDay(dayKey(next));
  };

  // Same source as the events tab: RLS limits the query to events I created,
  // RSVP'd to, or was invited to. Unanswered invitations aren't mine yet, so
  // they stay off the calendar until accepted.
  const load = useCallback(async () => {
    const [{ data }, pending] = await Promise.all([
      supabase.from('events').select('*').order('starts_at', { ascending: true }),
      loadPendingInvitations(userId),
    ]);
    const invitedIds = new Set(pending.map((p) => p.event.id));
    setEvents((data ?? []).filter((e) => !invitedIds.has(e.id)));
    // This is the landing tab, so it does the same on-fetch upkeep as the
    // events tab: these helpers remember what they've already handled, so
    // running them from both screens never double-notifies.
    notifyEventInvitations(userId, pending);
    if (data) {
      syncEventReminders();
      notifyChatMessages(
        userId,
        data.map((e) => ({ id: e.id, title: e.title }))
      );
    }
    refreshUnread();
  }, [userId, refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    hapticLight();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Day key -> events on that day, built once per fetch.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const event of events) {
      for (const key of daysTouched(event)) {
        map.set(key, [...(map.get(key) ?? []), event]);
      }
    }
    return map;
  }, [events]);

  const unreadSet = useMemo(() => new Set(unreadChats), [unreadChats]);

  // A dot under every day with something on, highlighted in danger color if unread messages exist,
  // plus the selected-day circle.
  const markedDates = useMemo<MarkedDates>(() => {
    const marks: MarkedDates = {};
    for (const [key, dayEvts] of eventsByDay.entries()) {
      const hasUnread = dayEvts.some((e) => unreadSet.has(e.id));
      marks[key] = {
        marked: true,
        dotColor: hasUnread ? colors.danger : colors.accent,
      };
    }
    marks[selectedDay] = {
      ...marks[selectedDay],
      selected: true,
      selectedColor: colors.accent,
      selectedTextColor: colors.onAccent,
    };
    return marks;
  }, [eventsByDay, selectedDay, colors, unreadSet]);

  const openEvent = (event: Event) =>
    navigation.navigate('EventDetail', { eventId: event.id });

  const renderEventRow = (event: Event) => {
    const hasUnread = unreadSet.has(event.id);
    return (
      <Pressable
        key={event.id}
        onPress={() => openEvent(event)}
        style={({ pressed }) => [styles.eventRow, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.timeCol}>
          {/* One line each: "10:30 PM" fits the column, and shrinks a little
              rather than wrapping if the text is set larger. */}
          <Text style={styles.timeText} numberOfLines={1}>
            {formatTime(event.starts_at)}
          </Text>
          <Text style={styles.timeEnd} numberOfLines={1}>
            {formatTime(event.ends_at)}
          </Text>
        </View>
        <View style={styles.eventBody}>
          <Text style={type.h3} numberOfLines={1}>
            {event.title}
          </Text>
          {event.location ? (
            <Text style={type.caption} numberOfLines={1}>
              {placeLabel(event.location)}
            </Text>
          ) : null}
        </View>
        {hasUnread && <View style={styles.unreadDot} />}
      </Pressable>
    );
  };

  const dayEvents = eventsByDay.get(selectedDay) ?? [];
  const isToday = selectedDay === todayKey;
  // Day keys are YYYY-MM-DD, so they compare as dates.
  const isPastDay = selectedDay < todayKey;

  // A day with nothing on it. Past days can't be planned any more, so they
  // just say so.
  const renderEmptyDay = () => (
    <View style={styles.emptyDayWrap}>
      <Text style={styles.emptyText}>
        {isPastDay ? 'Nothing was planned this day.' : 'Nothing planned this day.'}
      </Text>
      {!isPastDay && (
        <Button
          title="Plan something"
          variant="secondary"
          onPress={() => navigation.navigate('CreateEvent', { initialDate: selectedDay })}
          style={styles.emptyDayBtn}
        />
      )}
    </View>
  );

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.card}
    />
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={type.title}>Calendar</Text>
        <View style={styles.headerRight}>
          <View style={styles.toggle}>
            {(['month', 'day'] as ViewMode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => setViewMode(m)}
                style={[styles.toggleOption, viewMode === m && styles.toggleActive]}
              >
                <Text
                  style={[
                    styles.toggleText,
                    viewMode === m && { color: colors.onAccent },
                  ]}
                >
                  {m === 'month' ? 'Month' : 'Day'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {viewMode === 'month' ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}
          refreshControl={refreshControl}
        >
          <Calendar
            // The library caches its styles, so remount when the theme flips.
            key={mode}
            current={selectedDay}
            markedDates={markedDates}
            onDayPress={(d: DateData) => setSelectedDay(d.dateString)}
            firstDay={0}
            enableSwipeMonths
            style={styles.calendar}
            theme={{
              calendarBackground: colors.card,
              textSectionTitleColor: colors.inkMuted,
              dayTextColor: colors.ink,
              todayTextColor: colors.accentText,
              monthTextColor: colors.ink,
              arrowColor: colors.ink,
              textDisabledColor: colors.line,
              selectedDayBackgroundColor: colors.accent,
              selectedDayTextColor: colors.onAccent,
              dotColor: colors.accent,
              selectedDotColor: colors.onAccent,
              textDayFontFamily: fonts.body,
              textMonthFontFamily: fonts.display,
              textDayHeaderFontFamily: fonts.bodySemiBold,
              textMonthFontSize: 18,
              textDayHeaderFontSize: 12,
            }}
          />

          <View style={styles.dayBlock}>
            <SectionLabel>{formatDay(`${selectedDay}T12:00:00`)}</SectionLabel>
            {dayEvents.length > 0 ? (
              <View style={styles.eventListWrap}>
                {dayEvents.map((event, i) => (
                  <View key={event.id}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    {renderEventRow(event)}
                  </View>
                ))}
              </View>
            ) : (
              renderEmptyDay()
            )}
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.dayViewContent,
            { paddingBottom: bottomInset + spacing.xxl },
          ]}
          refreshControl={refreshControl}
        >
          <View style={styles.dayNavCard}>
            <Pressable
              onPress={() => shiftDay(-1)}
              style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
              accessibilityLabel="Previous day"
            >
              <ArrowIcon size={18} color={colors.ink} direction="left" />
            </Pressable>

            <View style={styles.dayNavCenter}>
              <Text style={styles.dayNavWeekday}>
                {new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long',
                })}
              </Text>
              <Text style={styles.dayNavTitle} numberOfLines={1} adjustsFontSizeToFit>
                {new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, {
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
              {!isToday && (
                <Pressable
                  onPress={() => setSelectedDay(todayKey)}
                  style={({ pressed }) => [
                    styles.todayBadge,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.todayBadgeText}>Jump to Today</Text>
                </Pressable>
              )}
            </View>

            <Pressable
              onPress={() => shiftDay(1)}
              style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
              accessibilityLabel="Next day"
            >
              <ArrowIcon size={18} color={colors.ink} direction="right" />
            </Pressable>
          </View>

          <View style={styles.dayList}>
            {dayEvents.length > 0 ? (
              <View style={styles.eventListWrap}>
                {dayEvents.map((event, i) => (
                  <View key={event.id}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    {renderEventRow(event)}
                  </View>
                ))}
              </View>
            ) : (
              renderEmptyDay()
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    createBtn: {
      padding: spacing.xs,
      justifyContent: 'center',
      alignItems: 'center',
    },
    toggle: {
      flexDirection: 'row',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
      backgroundColor: c.card,
      overflow: 'hidden',
    },
    toggleOption: {
      paddingVertical: 5,
      paddingHorizontal: spacing.md,
    },
    toggleActive: {
      backgroundColor: c.accent,
    },
    toggleText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    calendar: {
      marginHorizontal: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.card,
      overflow: 'hidden',
      paddingBottom: spacing.sm,
    },
    dayBlock: {
      paddingHorizontal: spacing.lg,
      marginTop: spacing.lg,
    },
    emptyDayWrap: {
      paddingVertical: spacing.md,
      gap: spacing.sm,
      alignItems: 'flex-start',
    },
    emptyText: {
      ...t.bodyMuted,
    },
    emptyDayBtn: {
      height: 38,
      paddingHorizontal: spacing.lg,
    },
    dayViewContent: {
      paddingHorizontal: spacing.lg,
    },
    dayNavCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.card,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.lg,
    },
    navBtn: {
      width: 40,
      height: 40,
      borderRadius: radii.control,
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayNavCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    dayNavWeekday: {
      ...t.caption,
      fontFamily: fonts.bodyMedium,
      textAlign: 'center',
    },
    dayNavTitle: {
      ...t.h3,
      fontFamily: fonts.heading,
      color: c.ink,
      textAlign: 'center',
    },
    todayBadge: {
      marginTop: 4,
      paddingVertical: 2,
      paddingHorizontal: spacing.sm,
      backgroundColor: c.line,
      borderRadius: radii.full,
    },
    todayBadgeText: {
      ...t.caption,
      color: c.inkMuted,
      fontFamily: fonts.bodySemiBold,
      fontSize: 11,
    },
    dayList: {
      flex: 1,
    },
    eventListWrap: {
      backgroundColor: 'transparent',
    },
    eventRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      backgroundColor: 'transparent',
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginLeft: 96, // the time column plus the row gap
    },
    timeCol: {
      width: 84,
    },
    timeText: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
    },
    timeEnd: {
      ...t.caption,
    },
    eventBody: {
      flex: 1,
      gap: 2,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
    },
  });
