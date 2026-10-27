// Date formatting helpers. Hermes ships Intl on both platforms, so
// toLocaleString is safe and respects the user's locale.

export function monthShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
}

export function dayOfMonth(iso: string): string {
  return String(new Date(iso).getDate());
}

// "Sat, Sep 12"
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Event times move in 5-minute steps (the time picker's minute wheel).
export const TIME_STEP_MINUTES = 5;
const STEP_MS = TIME_STEP_MINUTES * 60 * 1000;

// The first step at or after d: 6:55:00 stays 6:55, 6:55:30 becomes 7:00.
export function nextTimeStep(d: Date): Date {
  return new Date(Math.ceil(d.getTime() / STEP_MS) * STEP_MS);
}

// Some locales (en-CA among them) write "7:30 p.m."; the app always says
// "7:30 PM".
export function tidyDayPeriod(time: string): string {
  return time.replace(/\s?([ap])\.\s?m\./gi, (_, p: string) => ` ${p.toUpperCase()}M`);
}

// "7:30 PM"
export function formatTime(iso: string): string {
  return tidyDayPeriod(
    new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  );
}

// Chat timestamps: just the time for today, with the day added once the
// message is older, so an old thread still says when things were said.
export function formatMessageTime(iso: string): string {
  const sameDay = new Date(iso).toDateString() === new Date().toDateString();
  return sameDay ? formatTime(iso) : `${formatDay(iso)}, ${formatTime(iso)}`;
}

// "Sat, Sep 12, 7:30 PM to 10:00 PM" (or spelling out both days when it spans one)
export function formatSpan(startIso: string, endIso: string): string {
  const sameDay =
    new Date(startIso).toDateString() === new Date(endIso).toDateString();
  const start = `${formatDay(startIso)}, ${formatTime(startIso)}`;
  const end = sameDay
    ? formatTime(endIso)
    : `${formatDay(endIso)}, ${formatTime(endIso)}`;
  return `${start} to ${end}`;
}

// "7 PM" or "7:30 PM"
function formatHourTime(iso: string): string {
  const d = new Date(iso);
  const hasMins = d.getMinutes() !== 0;
  return tidyDayPeriod(
    d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      ...(hasMins ? { minute: '2-digit' } : {}),
    })
  );
}

// Live countdown for hero event: "Happening now", "In 3 hours", "Tomorrow at 7 PM", etc.
export function formatLiveCountdown(startIso: string, endIso: string): string {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();

  if (now >= start && now <= end) {
    return 'Happening now';
  }

  const diffMs = start - now;
  if (diffMs <= 0) {
    return 'Happening now';
  }

  const diffMins = Math.round(diffMs / (60 * 1000));
  if (diffMins < 60) {
    if (diffMins <= 1) return 'In 1 minute';
    return `In ${diffMins} minutes`;
  }

  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  if (diffHours < 6) {
    if (diffHours === 1) return 'In 1 hour';
    return `In ${diffHours} hours`;
  }

  const startDate = new Date(startIso);
  const nowDate = new Date(now);
  const isSameDay = startDate.toDateString() === nowDate.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(nowDate.getDate() + 1);
  const isTomorrow = startDate.toDateString() === tomorrow.toDateString();

  const timeStr = formatHourTime(startIso);

  if (isSameDay) {
    return `Today at ${timeStr}`;
  }

  if (isTomorrow) {
    return `Tomorrow at ${timeStr}`;
  }

  const weekday = startDate.toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday} at ${timeStr}`;
}

