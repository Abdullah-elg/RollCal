// The minimum age check. Asked neutrally (year first, then the month only
// when the year can't settle it), and the date itself is never stored.
// No React Native imports, so `npm test` can run it.

export const MIN_AGE = 13;

export type AgeResult = 'ok' | 'too_young' | 'need_month' | 'invalid';

// month is 1-12, or null when it hasn't been asked yet.
export function checkAge(year: number, month: number | null, now: Date = new Date()): AgeResult {
  const thisYear = now.getFullYear();
  if (!Number.isInteger(year) || year < thisYear - 120 || year > thisYear) return 'invalid';
  const years = thisYear - year;
  if (years > MIN_AGE) return 'ok';
  if (years < MIN_AGE) return 'too_young';
  // Turns 13 this year: depends on whether their birthday month has come.
  if (month === null) return 'need_month';
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'invalid';
  // A birthday later this month might not have arrived yet, so it counts
  // as not yet.
  return month < now.getMonth() + 1 ? 'ok' : 'too_young';
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
