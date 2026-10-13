import { supabase } from './supabase';
import { getChatReadMap, getPhotoReadMap } from './unread';

/**
 * Computes a short, friendly activity line for an event:
 * - "3 new messages" (when unread chat messages exist)
 * - "Sara added 6 photos" (when photos were added recently by an attendee)
 * - "2 people joined today" / "Sara joined today" (when people RSVP'd going today)
 */
export async function loadEventActivity(
  eventId: string,
  userId: string
): Promise<string | null> {
  try {
    const [chatReadMap, photoReadMap] = await Promise.all([
      getChatReadMap(userId),
      getPhotoReadMap(userId),
    ]);

    const chatReadAt = chatReadMap[eventId];
    const photoReadAt = photoReadMap[eventId];

    // 1. Priority: Check unread chat messages for this event
    const { data: messages } = await supabase
      .from('messages')
      .select('id, sender_id, created_at')
      .eq('event_id', eventId)
      .neq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    const unreadMsgs = (messages ?? []).filter(
      (m) => !chatReadAt || m.created_at > chatReadAt
    );
    if (unreadMsgs.length > 0) {
      return `${unreadMsgs.length} new ${
        unreadMsgs.length === 1 ? 'message' : 'messages'
      }`;
    }

    // 2. Priority: Check recent photos added by others
    const { data: photos } = await supabase
      .from('photos')
      .select('id, uploader_id, created_at')
      .eq('event_id', eventId)
      .neq('uploader_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (photos && photos.length > 0) {
      const now = Date.now();
      const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();
      const recentPhotos = photos.filter(
        (p) => (!photoReadAt || p.created_at > photoReadAt) || p.created_at >= twoDaysAgo
      );

      if (recentPhotos.length > 0) {
        const latestUploaderId = recentPhotos[0].uploader_id;
        const countByUploader = recentPhotos.filter(
          (p) => p.uploader_id === latestUploaderId
        ).length;

        const { data: uploaderProfile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', latestUploaderId)
          .maybeSingle();

        const name = uploaderProfile?.display_name?.split(' ')[0] ?? 'Someone';
        return `${name} added ${countByUploader} ${
          countByUploader === 1 ? 'photo' : 'photos'
        }`;
      }
    }

    // 3. Priority: Check people joined today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayIso = startOfToday.toISOString();

    const { data: rsvps } = await supabase
      .from('rsvps')
      .select('user_id, status, created_at')
      .eq('event_id', eventId)
      .in('status', ['going', 'host'])
      .neq('user_id', userId);

    if (rsvps && rsvps.length > 0) {
      const joinedToday = rsvps.filter(
        (r: any) => r.created_at && r.created_at >= todayIso
      );

      if (joinedToday.length > 0) {
        if (joinedToday.length === 1) {
          const { data: joinerProfile } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', joinedToday[0].user_id)
            .maybeSingle();
          const name = joinerProfile?.display_name?.split(' ')[0] ?? '1 person';
          return `${name} joined today`;
        }
        return `${joinedToday.length} people joined today`;
      }
    }

    return null;
  } catch {
    return null;
  }
}
