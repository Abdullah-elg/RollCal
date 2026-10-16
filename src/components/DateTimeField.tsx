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
import { formatTime } from '../lib/dates';
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
};

// A snap-scrolling wheel column. Pure ScrollView - no native picker, so it
// scrolls seamlessly on both platforms and matches the design language.
function Wheel({ items, index, onChange }: WheelProps) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const scrollRef = useRef<ScrollView>(null);
  // The index this wheel last told the parent about; lets the sync effect
  // distinguish external value changes from our own scroll reports.
  const reportedRef = useRef(index);
  const [liveIndex, setLiveIndex] = useState(index);

  // External change (e.g. end time dragged along by the start) → re-position.
  useEffect(() => {
    if (index !== reportedRef.current) {
      reportedRef.current = index;
      setLiveIndex(index);
      scrollRef.current?.scrollTo({ y: index * ITEM_H, animated: false });
    }
  }, [index]);

  const clampIndex = (offsetY: number) =>
    Math.max(0, Math.min(items.length - 1, Math.round(offsetY / ITEM_H)));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setLiveIndex(clampIndex(e.nativeEvent.contentOffset.y));
  };

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = clampIndex(e.nativeEvent.contentOffset.y);
    if (idx !== reportedRef.current) {
      reportedRef.current = idx;
      onChange(idx);
    }
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
        onScrollEndDrag={settle}
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

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, '0')
);

type Props = {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  // Passed through to the calendar: earlier days can't be picked.
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

  const setTime = (h12: number, min: number, pm: boolean) => {
    const next = new Date(value);
    next.setHours((h12 % 12) + (pm ? 12 : 0), min, 0, 0);
    onChange(next);
  };

  const setDatePart = (picked: Date) => {
    const next = new Date(picked);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(next);
  };

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
        />
        <Text style={styles.colon}>:</Text>
        <Wheel
          items={MINUTES}
          index={minute / 5}
          onChange={(i) => setTime(hour12, i * 5, isPM)}
        />
        <View style={styles.ampmColumn}>
          <Pressable
            style={[styles.ampmSegment, !isPM && styles.ampmActive]}
            onPress={() => setTime(hour12, minute, false)}
          >
            <Text style={[styles.ampmText, !isPM && styles.ampmTextActive]}>AM</Text>
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
      borderRadius: 16,
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
      borderRadius: radii.sm,
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
      borderRadius: radii.sm,
      padding: 2,
      gap: 2,
    },
    ampmSegment: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.sm - 2,
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
