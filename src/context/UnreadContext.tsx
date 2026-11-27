// App-wide counts of what's waiting: unread chats, new photos, friend
// requests, event invitations and photos reported to you as host. The tab bar reads them, and screens call
// the mark-as-read functions to clear a dot right away.

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { loadWaitingHostReports } from '../lib/hostReports';
import { setAppBadge } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import {
  loadChangedEvents,
  loadUnreadChats,
  loadUnreadPhotos,
  markEventSeen as markEventSeenLib,
  markChatRead,
  markPhotosRead as markPhotosReadLib,
} from '../lib/unread';
import { useAuth } from './AuthContext';

// What's waiting for you, app-wide - so the tab bar can show it without
// every screen having to pass state upward.
type UnreadContextValue = {
  // Events whose chat has something new.
  unreadChats: string[];
  // Events that have new photos.
  unreadPhotos: string[];
  // Events whose name, place, time or description the host changed since
  // you last opened them.
  changedEvents: string[];
  // Friend requests waiting on an answer.
  friendRequests: number;
  // Invitations waiting on an answer.
  pendingInvites: number;
  // Photos reported to you as host, until you keep or delete them.
  hostReports: WaitingHostReport[];
  refresh: () => Promise<void>;
  // Called when a chat is read, clearing its dot immediately.
  markRead: (eventId: string, timestamp: string) => Promise<void>;
  // Called when event photos are viewed, clearing new photos mark.
  markPhotosRead: (eventId: string, timestamp: string) => Promise<void>;
  // Called when an event is opened, clearing its "changed" mark.
  markEventSeen: (eventId: string) => Promise<void>;
};

export type WaitingHostReport = { id: string; event_id: string; photo_id: string };

const UnreadContext = createContext<UnreadContextValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [unreadChats, setUnreadChats] = useState<string[]>([]);
  const [unreadPhotos, setUnreadPhotos] = useState<string[]>([]);
  const [changedEvents, setChangedEvents] = useState<string[]>([]);
  const [friendRequests, setFriendRequests] = useState(0);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [hostReports, setHostReports] = useState<WaitingHostReport[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setUnreadChats([]);
      setUnreadPhotos([]);
      setChangedEvents([]);
      setFriendRequests(0);
      setPendingInvites(0);
      setHostReports([]);
      return;
    }
    const [{ data: events }, { data: requests }, { data: invites }, waiting] =
      await Promise.all([
        supabase.from('events').select('id'),
        supabase
          .from('friendships')
          .select('id')
          .eq('addressee_id', userId)
          .eq('status', 'pending'),
        supabase
          .from('invitations')
          .select('id')
          .eq('invited_user_id', userId)
          .eq('status', 'pending'),
        loadWaitingHostReports(userId),
      ]);

    setFriendRequests(requests?.length ?? 0);
    setPendingInvites(invites?.length ?? 0);
    setHostReports(waiting.map(({ id, event_id, photo_id }) => ({ id, event_id, photo_id })));
    const eventIds = (events ?? []).map((e) => e.id);
    const [unreadChatSet, unreadPhotoSet, changedSet] = await Promise.all([
      loadUnreadChats(userId, eventIds),
      loadUnreadPhotos(userId, eventIds),
      loadChangedEvents(userId, eventIds),
    ]);
    setUnreadChats([...unreadChatSet]);
    setUnreadPhotos([...unreadPhotoSet]);
    setChangedEvents([...changedSet]);
  }, [userId]);

  useEffect(() => {
    refresh();
    // Things change while the app is in the background; catch up on return.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // The app-icon number: unread chats, friend requests, invites and reports
  // waiting on you as host. Zero when signed out.
  const badge = userId
    ? unreadChats.length + friendRequests + pendingInvites + hostReports.length
    : 0;
  useEffect(() => {
    setAppBadge(badge);
  }, [badge]);

  const markRead = useCallback(
    async (eventId: string, timestamp: string) => {
      if (!userId) return;
      await markChatRead(userId, eventId, timestamp);
      setUnreadChats((prev) => prev.filter((id) => id !== eventId));
    },
    [userId]
  );

  const markPhotosRead = useCallback(
    async (eventId: string, timestamp: string) => {
      if (!userId) return;
      await markPhotosReadLib(userId, eventId, timestamp);
      setUnreadPhotos((prev) => prev.filter((id) => id !== eventId));
    },
    [userId]
  );

  const markEventSeen = useCallback(
    async (eventId: string) => {
      if (!userId) return;
      setChangedEvents((prev) => prev.filter((id) => id !== eventId));
      await markEventSeenLib(userId, eventId, new Date().toISOString());
    },
    [userId]
  );

  return (
    <UnreadContext.Provider
      value={{
        unreadChats,
        unreadPhotos,
        changedEvents,
        markEventSeen,
        friendRequests,
        pendingInvites,
        hostReports,
        refresh,
        markRead,
        markPhotosRead,
      }}
    >
      {children}
    </UnreadContext.Provider>
  );
}

export function useUnread() {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error('useUnread must be used inside UnreadProvider');
  return ctx;
}
