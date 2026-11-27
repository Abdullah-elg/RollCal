// Web guests joined from a browser without the app (supabase/guest-web.sql).
// They show with "(guest)" after their name wherever people are listed.

type NamedProfile = { display_name?: string | null; is_guest?: boolean | null } | null | undefined;

export function guestName(p: NamedProfile, fallback = 'Someone'): string {
  const name = p?.display_name?.trim() || fallback;
  return p?.is_guest ? `${name} (guest)` : name;
}
