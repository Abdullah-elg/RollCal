// App-wide row types mirroring the Supabase schema. Only the tables a stage
// actually uses get added here, to keep this honest.

export type Profile = {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  // Chosen at sign-up; unique, how people find each other.
  username: string | null;
  avatar_url?: string | null;
  // Set by hand in the dashboard until in-app purchases are live.
  is_pro: boolean;
  // Pro: friend requests to them are kept but hidden.
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
  uploads_closed: boolean;
  uploads_reopened_until?: string | null;
  cover_photo_id?: string | null;
  created_at: string;
};
