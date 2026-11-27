import { RsvpStatus } from '../types';
import { guestFacing, isEventFull, notifyHostFull } from './planLimits';
import { supabase } from './supabase';

// Insert-or-update done explicitly instead of upsert: the RLS insert policy
// re-checks "can join" (link enabled / invited), which an upsert would apply
// even to an existing member just switching status - e.g. after the leader
// turns the link off. Updating the existing row only needs "it's my row".
export async function setRsvp(
  eventId: string,
  userId: string,
  status: RsvpStatus
): Promise<string | null> {
  const { data: existing, error: selectError } = await supabase
    .from('rsvps')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (selectError) return selectError.message;

  if (existing) {
    const { error } = await supabase
      .from('rsvps')
      .update({ status })
      .eq('id', existing.id);
    if (error && isEventFull(error.message)) notifyHostFull(eventId);
    return error ? guestFacing(error.message) : null;
  }

  const { error } = await supabase
    .from('rsvps')
    .insert({ event_id: eventId, user_id: userId, status });
  if (error && isEventFull(error.message)) notifyHostFull(eventId);
  return error ? guestFacing(error.message) : null;
}
