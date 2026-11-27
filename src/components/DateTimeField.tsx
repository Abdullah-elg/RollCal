// A labeled date and time field. The date comes from CalendarPicker, the
// time from scroll wheels (5-minute steps) and an AM/PM toggle. The wheels
// are plain ScrollViews, so they behave the same on iOS and Android. On the
// first allowed day, times before minDate are greyed out and can't be chosen.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { formatTime, nextTimeStep } from '../lib/dates';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
import CalendarPicker from './CalendarPicker';

const ITEM_H = 38;
// Items visible in a wheel column (odd, so one sits centered).
const VISIBLE = 3;
const WHEEL_H = ITEM_H * VISIBLE;
const PAD = (WHEEL_H - ITEM_H) / 2;

type WheelProps = {
  items: string[];
  index: number;
  onChange: (index: number) => void;
  // Items that can't be chosen (times already gone). They're greyed out, and
  // a wheel that stops on one springs to the nearest one that can be.
  isDisabled?: (index: number) => boolean;
};

// A snap-scrolling wheel column. Pure ScrollView - no native picker, so it
// scrolls seamlessly on both platforms and matches the design language.
function Wheel({ items, index, onChange, isDisabled }: WheelProps) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const scrollRef = useRef<ScrollView>(null);
  // The index this wheel last told the parent about; lets the sync effect
  // distinguish external value changes from our own scroll reports.
  const reportedRef = useRef(index);
  const [liveIndex, setLiveIndex] = useState(index);
  // Where the wheel is, from its scroll events.
  const offsetRef = useRef(index * ITEM_H);
  // The glide in progress, if any (see glideTo).
  const glideFrameRef = useRef<number | null>(null);
  const stopGlide = () => {
    if (glideFrameRef.current !== null) cancelAnimationFrame(glideFrameRef.current);
    glideFrameRef.current = null;
  };
  useEffect(() => stopGlide, []);

  // External change (the end pushed along by the start, or the clock moving
  // a start that just passed) → glide there.
  useEffect(() => {
    if (index !== reportedRef.current) {
      reportedRef.current = index;
      setLiveIndex(index);
      glideTo(offsetRef.current, index * ITEM_H);
    }
  }, [index]);

  const clampIndex = (offsetY: number) =>
    Math.max(0, Math.min(items.length - 1, Math.round(offsetY / ITEM_H)));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = e.nativeEvent.contentOffset.y;
    setLiveIndex(clampIndex(e.nativeEvent.contentOffset.y));
  };

  const nearestAllowed = (idx: number) => {
    if (!isDisabled?.(idx)) return idx;
    for (let step = 1; step < items.length; step++) {
      for (const i of [idx + step, idx - step]) {
        if (i >= 0 && i < items.length && !isDisabled(i)) return i;
      }
    }
    return idx;
  };

  // Slides the wheel from one offset to another. iOS drops its own animated
  // scroll when it's started from a stopped drag (it reports it finished on
  // the spot, which once left the wheel stuck), but it always takes a plain
  // position change, so the glide is a quick run of those: about a quarter
  // second, easing out, a little longer for a longer way.
  const glideTo = (from: number, to: number) => {
    stopGlide();
    const duration = Math.min(400, 160 + (Math.abs(to - from) / ITEM_H) * 60);
    const started = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      scrollRef.current?.scrollTo({ y: from + (to - from) * eased, animated: false });
      glideFrameRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    glideFrameRef.current = requestAnimationFrame(step);
  };

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const landed = clampIndex(e.nativeEvent.contentOffset.y);
    const idx = nearestAllowed(landed);
    // Put the wheel exactly on idx: a slow drag can stop between two
    // numbers (iOS only snaps after a flick), and it may have stopped on a
    // greyed-out one.
    if (Math.abs(e.nativeEvent.contentOffset.y - idx * ITEM_H) > 0.5) {
      glideTo(e.nativeEvent.contentOffset.y, idx * ITEM_H);
    }
    if (idx !== reportedRef.current) {
      reportedRef.current = idx;
      onChange(idx);
    }
  };

  // A flick keeps the wheel coasting, and onMomentumScrollEnd settles it
  // when it stops. Settling here as well would race the coast and could
  // leave the wheel resting between two numbers.
  const endDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Math.abs(e.nativeEvent.velocity?.y ?? 0) < 0.05) settle(e);
  };

  return (
    <View style={styles.wheel}>
      <ScrollView
        ref={scrollRef}
        style={{ height: WHEEL_H }}
        contentContainerStyle={{ paddingVertical: PAD }}
        showsVerticalScrollIndicator={false}
        // Without this, Android's outer form ScrollView swallows the gesture.
        nestedScrollEnabled
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={settle}
        // A finger on the wheel takes over from any glide.
        onScrollBeginDrag={stopGlide}
        onScrollEndDrag={endDrag}
        onLayout={() =>
          scrollRef.current?.scrollTo({ y: index * ITEM_H, animated: false })
        }
      >
        {items.map((item, i) => (
          <View key={item} style={styles.wheelItem}>
            <Text
              style={[
                styles.wheelText,
                i === liveIndex && styles.wheelTextSelected,
                isDisabled?.(i) && styles.wheelTextDisabled,
              ]}
            >
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>
      {/* Center band the selection sits in. pointerEvents=none keeps it from
          stealing scroll gestures. */}
      <View pointerEvents="none" style={styles.wheelBand} />
    </View>
  );
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, '0')
);

type Props = {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  // The earliest moment allowed: earlier days can't be picked on the
  // calendar, and on that day earlier times are greyed out.
  minDate?: Date;
};

// Date from the in-app themed calendar; time from scroll wheels (hour,
// minute in 5-minute steps) plus an AM/PM toggle.
export default function DateTimeField({ label, value, onChange, minDate }: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [showCalendar, setShowCalendar] = useState(false);

  const hour12 = value.getHours() % 12 === 0 ? 12 : value.getHours() % 12;
  const isPM = value.getHours() >= 12;
  const minute = (Math.round(value.getMinutes() / 5) * 5) % 60;

  // The earliest time that can be picked, rounded up to the wheels' 5-minute
  // steps. Only matters on that same day; later days allow any time.
  const minTime = minDate?.getTime();
  const earliest = useMemo(
    () => (minTime === undefined ? null : nextTimeStep(new Date(minTime))),
    [minTime]
  );
  const onEarliestDay = !!earliest && sameDay(value, earliest);

  // Never hand back a time before the earliest one.
  const atLeastEarliest = (next: Date) =>
    earliest && next.getTime() < earliest.getTime() ? new Date(earliest) : next;

  const setTime = (h12: number, min: number, pm: boolean) => {
    const next = new Date(value);
    next.setHours((h12 % 12) + (pm ? 12 : 0), min, 0, 0);
    onChange(atLeastEarliest(next));
  };

  const setDatePart = (picked: Date) => {
    const next = new Date(picked);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(atLeastEarliest(next));
  };

  // What's already gone on the earliest day. An hour is gone once its last
  // 5-minute step is; a minute once that time in the shown hour is.
  const hour24 = (h12: number, pm: boolean) => (h12 % 12) + (pm ? 12 : 0);
  const minutesOf = (h: number, m: number) => h * 60 + m;
  const earliestMinutes = earliest ? minutesOf(earliest.getHours(), earliest.getMinutes()) : 0;
  const hourGone = (i: number) =>
    onEarliestDay && minutesOf(hour24(i + 1, isPM), 55) < earliestMinutes;
  const minuteGone = (i: number) =>
    onEarliestDay && minutesOf(hour24(hour12, isPM), i * 5) < earliestMinutes;
  const amGone = onEarliestDay && earliestMinutes >= 12 * 60;

  const dateLabel = value.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.timeReadout}>
          {dateLabel} · {formatTime(value.toISOString())}
        </Text>
      </View>

      <Pressable
        style={[styles.dateChip, showCalendar && styles.dateChipActive]}
        onPress={() => setShowCalendar((s) => !s)}
      >
        <Text style={type.body}>{dateLabel}</Text>
      </Pressable>
      {showCalendar && (
        <View style={{ marginBottom: spacing.sm }}>
          <CalendarPicker
            value={value}
            minDate={minDate}
            onChange={(picked) => {
              setDatePart(picked);
              setShowCalendar(false);
            }}
          />
        </View>
      )}

      <View style={styles.timeRow}>
        <Wheel
          items={HOURS}
          index={hour12 - 1}
          onChange={(i) => setTime(i + 1, minute, isPM)}
          isDisabled={hourGone}
        />
        <Text style={styles.colon}>:</Text>
        <Wheel
          items={MINUTES}
          index={minute / 5}
          onChange={(i) => setTime(hour12, i * 5, isPM)}
          isDisabled={minuteGone}
        />
        <View style={styles.ampmColumn}>
          <Pressable
            style={[styles.ampmSegment, !isPM && styles.ampmActive]}
            onPress={() => setTime(hour12, minute, false)}
            disabled={amGone}
            accessibilityState={{ disabled: amGone, selected: !isPM }}
          >
            <Text
              style={[
                styles.ampmText,
                !isPM && styles.ampmTextActive,
                amGone && styles.wheelTextDisabled,
              ]}
            >
              AM
            </Text>
          </Pressable>
          <Pressable
            style={[styles.ampmSegment, isPM && styles.ampmActive]}
            onPress={() => setTime(hour12, minute, true)}
          >
            <Text style={[styles.ampmText, isPM && styles.ampmTextActive]}>PM</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    wrap: {
      marginBottom: spacing.lg,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.card,
      padding: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: spacing.sm,
    },
    label: {
      ...t.body,
      fontSize: 15,
      color: c.inkMuted,
    },
    timeReadout: {
      fontFamily: fonts.bodyMedium,
      fontSize: 14,
      color: c.inkMuted,
    },
    dateChip: {
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
      paddingHorizontal: spacing.md,
      height: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
      marginBottom: spacing.sm,
    },
    dateChipActive: {
      borderColor: c.ink,
    },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    wheel: {
      width: 64,
    },
    wheelItem: {
      height: ITEM_H,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wheelText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 18,
      color: c.inkMuted,
      opacity: 0.45,
    },
    wheelTextSelected: {
      fontFamily: fonts.headingMedium,
      fontSize: 20,
      color: c.ink,
      opacity: 1,
    },
    // Gone times: faint, and skipped over when a wheel stops on them.
    wheelTextDisabled: {
      opacity: 0.18,
    },
    wheelBand: {
      position: 'absolute',
      top: PAD,
      left: 0,
      right: 0,
      height: ITEM_H,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    colon: {
      fontFamily: fonts.heading,
      fontSize: 20,
      color: c.ink,
    },
    ampmColumn: {
      marginLeft: spacing.md,
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.control,
      padding: 2,
      gap: 2,
    },
    ampmSegment: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.control - 2,
      alignItems: 'center',
    },
    ampmActive: {
      backgroundColor: c.accent,
    },
    ampmText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.inkMuted,
    },
    ampmTextActive: {
      color: c.onAccent,
    },
  });
