// Who can add photos and who can chat in an event, as the app shows it. The
// database enforces the same rule (supabase/post-permissions.sql); this
// only decides what to show. No Supabase import, so it can be tested.

export type PostRule = 'everyone' | 'host';
export type PostKind = 'photos' | 'chat';

// One row of event_allowed: the people the host let in.
export type Allowed = { user_id: string; photos: boolean; chat: boolean };

export const POST_RULES: Record<PostKind, { rule: PostRule; label: string; detail: string }[]> = {
  photos: [
    { rule: 'everyone', label: 'Everyone', detail: 'Anyone in the event can add photos.' },
    {
      rule: 'host',
      label: 'Only you',
      detail: 'Only you, plus anyone you let in from their name in the guest list.',
    },
  ],
  chat: [
    { rule: 'everyone', label: 'Everyone', detail: 'Anyone in the event can send messages.' },
    {
      rule: 'host',
      label: 'Only you',
      detail: 'Others can read along. You can let people in from their name in the guest list.',
    },
  ],
};

export function ruleOf(
  event: { photos_by?: PostRule | null; chat_by?: PostRule | null },
  kind: PostKind
): PostRule {
  return (kind === 'photos' ? event.photos_by : event.chat_by) === 'host' ? 'host' : 'everyone';
}

// Whether this person may add photos / chat. The host always may.
export function mayPost(
  event: { creator_id: string; photos_by?: PostRule | null; chat_by?: PostRule | null },
  userId: string | null | undefined,
  kind: PostKind,
  allowed: Allowed[]
): boolean {
  if (!userId) return false;
  if (event.creator_id === userId) return true;
  if (ruleOf(event, kind) === 'everyone') return true;
  const mine = allowed.find((a) => a.user_id === userId);
  return !!mine && (kind === 'photos' ? mine.photos : mine.chat);
}

// What someone who can't post sees instead.
export const POST_BLOCKED_NOTE: Record<PostKind, string> = {
  photos: 'Only the host and people they pick can add photos.',
  chat: 'Only the host and people they pick can send messages.',
};
