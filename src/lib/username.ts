// Username rules, shared by sign-up, Edit profile and the profile created
// on first sign-in. supabase/usernames.sql enforces the same rule in the
// database, so keep the two in step.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

// Starts with a letter or number; then letters, numbers, dots, dashes or
// underscores.
const USERNAME_RULE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

// Names people would mistake for the app or its staff.
const RESERVED = new Set([
  'admin',
  'administrator',
  'help',
  'moderator',
  'official',
  'rollcal',
  'root',
  'staff',
  'support',
  'system',
]);

// What the person typed, as it will be saved.
export function cleanUsername(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase();
}

// Why a (cleaned) username can't be used, or null if it can.
export function usernameProblem(name: string): string | null {
  if (name.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!/^[a-z0-9]/.test(name)) return 'Start with a letter or number.';
  if (!USERNAME_RULE.test(name)) return 'Use letters, numbers, dots, dashes or underscores.';
  if (RESERVED.has(name)) return 'That username isn’t available.';
  return null;
}

// A starting username for people who signed in with Apple or Google and
// never typed one, made from their name (never their email, which would
// give the address away). They can change it in Edit profile.
export function usernameFromName(first: string | null, last: string | null): string {
  const base = [first, last]
    .filter(Boolean)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, USERNAME_MAX - 4);
  return base.length >= USERNAME_MIN && !RESERVED.has(base) ? base : 'member';
}

// Suffixed variants to try when the first choice is taken.
export function usernameFallbacks(base: string, random: () => number = Math.random): string[] {
  const trimmed = base.slice(0, USERNAME_MAX - 4);
  return [
    `${trimmed}${Math.floor(100 + random() * 900)}`,
    `${trimmed}${Math.floor(1000 + random() * 9000)}`,
  ];
}
