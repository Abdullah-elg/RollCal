// App-wide row types mirroring the Supabase schema. Only the tables a stage
// actually uses get added here, to keep this honest.

export type Plan = 'free' | 'plus' | 'pro';

export type Profile = {
  id: string;
  display_name: string;
  // Joined an event from a web browser without the app (guest-web.sql).
  // Missing on databases before that file ran.
  is_guest?: boolean;
  // Profile photo visible to everyone signed in, not just friends
  // (avatar-visibility.sql). Missing on old rows: friends only.
  avatar_public?: boolean;
  first_name: string | null;
  last_name: string | null;
  // Chosen at sign-up; unique, how people find each other.
  username: string | null;
  avatar_url?: string | null;
  // Set by hand in the dashboard until in-app purchases are live. Always
  // plan !== 'free' (plans.sql keeps them in step); kept for older builds.
  is_pro: boolean;
  // Admin-only. Use planOf (lib/pro.ts), which respects plan_expires_at.
  plan: Plan;
  // When the plan ends; null for no end.
  plan_expires_at: string | null;
  // Friend requests to them are kept but hidden.
  quiet_mode: boolean;
  // Preferred currency for bills and prices; null until they choose one.
  currency: string | null;
  created_at: string;
};

export type Photo = {
  id: string;
  event_id: string;
  uploader_id: string;
  storage_path: string;
  // Filled in by the database from the stored file (see media.sql).
  kind: 'photo' | 'video';
  size_bytes: number | null;
  // Videos only; from the phone's picker, for the "0:42" on the tile.
  duration_ms: number | null;
  created_at: string;
};

export type Message = {
  id: string;
  event_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  // Set when the sender edited it (within 10 minutes of sending).
  edited_at?: string | null;
  // The message this one answers (see supabase/message-replies.sql).
  reply_to?: string | null;
};

export type InvitationStatus = 'pending' | 'accepted' | 'declined';

export type Invitation = {
  id: string;
  event_id: string;
  invited_user_id: string;
  invited_by: string;
  status: InvitationStatus;
};

export type RsvpStatus = 'going' | 'maybe' | 'not_going';

export type Event = {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  starts_at: string;
  ends_at: string;
  invite_code: string;
  is_link_enabled: boolean;
  // Who can join from the link: see lib/joinRequests. Missing on rows read
  // before join-modes.sql ran, which behave as 'open' or 'invite'.
  join_mode?: 'open' | 'approval' | 'invite';
  // Who can add photos / chat: everyone, or the host and people they pick
  // (post-permissions.sql). Missing on rows from before it ran: everyone.
  photos_by?: 'everyone' | 'host';
  chat_by?: 'everyone' | 'host';
  // Bill splitting on/off (bills-toggle.sql). Missing on old rows: on.
  bills_enabled?: boolean;
  uploads_closed: boolean;
  uploads_reopened_until?: string | null;
  cover_photo_id?: string | null;
  // Set when the host deleted an event that's over: it goes at this time
  // (see supabase/event-delete.sql). Missing before that migration ran.
  delete_at?: string | null;
  created_at: string;
};
