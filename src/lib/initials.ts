// The letters shown on an avatar with no photo. Pure, so it's unit-tested.
//
// Only letters count (any alphabet): an emoji, number or symbol never shows,
// because half an emoji draws as "?". With a first and last name, both
// initials show when both are letters, and just the one that is otherwise.
// With neither, the username's first letter stands in, as a capital.

const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);

// The first character of a word as the reader sees it (an emoji is one
// character here, not two halves).
const firstChar = (word: string) => Array.from(word)[0];

export function avatarInitials(
  name: string | null | undefined,
  username?: string | null
): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  let initials = '';
  if (words.length === 1) {
    // One word: its first two letters, like "Ab" for Abdullah.
    const chars = Array.from(words[0]);
    if (isLetter(chars[0])) initials = isLetter(chars[1]) ? chars[0] + chars[1] : chars[0];
  } else if (words.length > 1) {
    const first = firstChar(words[0]);
    const last = firstChar(words[words.length - 1]);
    initials = (isLetter(first) ? first : '') + (isLetter(last) ? last : '');
  }
  if (initials) return initials.toUpperCase();

  const userInitial = Array.from(username ?? '').find(isLetter);
  return userInitial ? userInitial.toUpperCase() : '';
}

// True when the name alone gives no initials, so the username is needed.
export const needsUsernameInitial = (name: string | null | undefined) =>
  avatarInitials(name) === '';
