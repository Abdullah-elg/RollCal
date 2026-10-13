import { Event, Invitation, Profile } from '../types';
import { setRsvp } from './rsvp';
import { supabase } from './supabase';

// Direct invitations live alongside the open invite link: the leader picks
// specific friends, and those people get a pending invitation to answer.

export type PendingInvitation = {
  invitation: Invitation;
  event: Event;
  hostName: string;
};

// Invitations waiting on me to answer.
export async function loadPendingInvitations(
  userId: string
): Promise<PendingInvitation[]> {
  const { data: invites } = await supabase
    .from('invitations')
    .select('*')
    .eq('invited_user_id', userId)
    .eq('status', 'pending');
  if (!invites || invites.length === 0) return [];

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .in(
      'id',
      invites.map((i) => i.event_id)
    );
  const hostIds = [...new Set((events ?? []).map((e) => e.creator_id))];
  const { data: profiles } =
    hostIds.length > 0
      ? await supabase.from('profiles').select('id, display_name').in('id', hostIds)
      : { data: [] };

  const out: PendingInvitation[] = [];
  for (const invitation of invites) {
    const event = events?.find((e) => e.id === invitation.event_id);
    // The event may have been cancelled since the invite was sent.
    if (!event) continue;
    out.push({
      invitation,
      event,
      hostName:
        profiles?.find((p) => p.id === event.creator_id)?.display_name ?? 'Someone',
    });
  }
  return out.sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
}

export type EventInvitation = {
  invitation: Invitation;
  profile: Profile;
};

// Everyone the leader has invited to one event, whatever their answer.
export async function loadEventInvitations(
  eventId: string
): Promise<EventInvitation[]> {
  const { data: invites } = await supabase
    .from('invitations')
    .select('*')
    .eq('event_id', eventId);
  if (!invites || invites.length === 0) return [];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in(
      'id',
      invites.map((i) => i.invited_user_id)
    );
  return invites
    .map((invitation) => ({
      invitation,
      profile: profiles?.find((p) => p.id === invitation.invited_user_id),
    }))
    .filter((row): row is EventInvitation => row.profile !== undefined)
    .sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name));
}

// Leader only - RLS enforces that, plus the ban check.
export async function inviteFriend(
  eventId: string,
  friendId: string,
  userId: string
): Promise<string | null> {
  const { error } = await supabase.from('invitations').insert({
    event_id: eventId,
    invited_user_id: friendId,
    invited_by: userId,
    status: 'pending',
  });
  if (!error) return null;
  // 23505 = the unique (event, person) pair: they already have an invite.
  if (error.code === '23505') return 'They already have an invitation.';
  // The RLS insert policy also rejects anyone removed from the event.
  if (error.code === '42501') return "They were removed from this event and can't be invited back.";
  return error.message;
}

// Accepting both answers the invitation and puts them in the event, so they
// show up under "Who's in" with a status they can change later.
export async function acceptInvitation(
  invitation: Invitation,
  userId: string
): Promise<string | null> {
  const { error } = await supabase
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('id', invitation.id);
  if (error) return error.message;
  return setRsvp(invitation.event_id, userId, 'going');
}

export async function declineInvitation(
  invitationId: string
): Promise<string | null> {
  const { error } = await supabase
    .from('invitations')
    .update({ status: 'declined' })
    .eq('id', invitationId);
  return error ? error.message : null;
}

// Leader withdrawing an invitation, or an invitee clearing one out.
export async function removeInvitation(
  invitationId: string
): Promise<string | null> {
  const { error } = await supabase
    .from('invitations')
    .delete()
    .eq('id', invitationId);
  return error ? error.message : null;
}

export type PendingInviteRequestItem = {
  id: string;
  eventId: string;
  suggestedUser: Profile;
  requester: Profile;
};

// Host loads pending requests from attendees
export async function loadPendingInviteRequests(
  eventId: string
): Promise<PendingInviteRequestItem[]> {
  const { data: requests, error } = await supabase
    .from('event_invite_requests')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'pending');

  if (error || !requests || requests.length === 0) return [];

  const userIds = [
    ...new Set([
      ...requests.map((r) => r.suggested_user_id),
      ...requests.map((r) => r.requested_by),
    ]),
  ];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', userIds);

  const out: PendingInviteRequestItem[] = [];
  for (const req of requests) {
    const suggestedUser = profiles?.find((p) => p.id === req.suggested_user_id);
    const requester = profiles?.find((p) => p.id === req.requested_by);
    if (suggestedUser && requester) {
      out.push({
        id: req.id,
        eventId: req.event_id,
        suggestedUser,
        requester,
      });
    }
  }
  return out;
}

// Attendee loads IDs of friends they have requested to invite
export async function loadMyInviteRequests(
  eventId: string,
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('event_invite_requests')
    .select('suggested_user_id')
    .eq('event_id', eventId)
    .eq('requested_by', userId)
    .eq('status', 'pending');

  if (error || !data) return [];
  return data.map((r) => r.suggested_user_id);
}

// Attendee requests host to invite a friend
export async function requestInviteFriend(
  eventId: string,
  friendId: string,
  userId: string
): Promise<string | null> {
  const { error } = await supabase.from('event_invite_requests').insert({
    event_id: eventId,
    suggested_user_id: friendId,
    requested_by: userId,
    status: 'pending',
  });

  if (!error) return null;
  if (error.code === '23505') return 'This friend has already been requested or invited.';
  if (error.code === '42P01') return 'Database table not ready yet. Please run the migration script.';
  return error.message;
}

// Attendee withdraws their request
export async function withdrawInviteRequest(
  eventId: string,
  friendId: string,
  userId: string
): Promise<string | null> {
  const { error } = await supabase
    .from('event_invite_requests')
    .delete()
    .eq('event_id', eventId)
    .eq('suggested_user_id', friendId)
    .eq('requested_by', userId);

  return error ? error.message : null;
}

// Host approves request: adds to invitations so the friend gets invited
export async function approveInviteRequest(
  requestId: string
): Promise<string | null> {
  // Try RPC first
  const { error: rpcError } = await supabase.rpc('approve_invite_request', {
    p_request_id: requestId,
  });

  if (!rpcError) return null;

  // Fallback if RPC is not defined in DB yet
  const { data: req } = await supabase
    .from('event_invite_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (!req) return rpcError.message;

  const { error: invErr } = await supabase.from('invitations').insert({
    event_id: req.event_id,
    invited_user_id: req.suggested_user_id,
    invited_by: req.requested_by,
    status: 'pending',
  });

  if (invErr && invErr.code !== '23505') return invErr.message;

  await supabase.from('event_invite_requests').delete().eq('id', requestId);
  return null;
}

// Host declines request
export async function declineInviteRequest(
  requestId: string
): Promise<string | null> {
  const { error: rpcError } = await supabase.rpc('decline_invite_request', {
    p_request_id: requestId,
  });

  if (!rpcError) return null;

  const { error } = await supabase
    .from('event_invite_requests')
    .delete()
    .eq('id', requestId);

  return error ? error.message : null;
}
