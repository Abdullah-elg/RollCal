// App-wide counts of what's waiting: unread chats, new photos, friend
// requests and event invitations. The tab bar reads them, and screens call
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
import { setAppBadge } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import {
  loadUnreadChats,
  loadUnreadPhotos,
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
  // Friend requests waiting on an answer.
  friendRequests: number;
  // Invitations waiting on an answer.
  pendingInvites: number;
  refresh: () => Promise<void>;
  // Called when a chat is read, clearing its dot immediately.
  markRead: (eventId: string, timestamp: string) => Promise<void>;
  // Called when event photos are viewed, clearing new photos mark.
  markPhotosRead: (eventId: string, timestamp: string) => Promise<void>;
};

const UnreadContext = createContext<UnreadContextValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [unreadChats, setUnreadChats] = useState<string[]>([]);
  const [unreadPhotos, setUnreadPhotos] = useState<string[]>([]);
  const [friendRequests, setFriendRequests] = useState(0);
  const [pendingInvites, setPendingInvites] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setUnreadChats([]);
      setUnreadPhotos([]);
      setFriendRequests(0);
      setPendingInvites(0);
      return;
    }
    const [{ data: events }, { data: requests }, { data: invites }] =
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
      ]);

    setFriendRequests(requests?.length ?? 0);
    setPendingInvites(invites?.length ?? 0);
    const eventIds = (events ?? []).map((e) => e.id);
    const [unreadChatSet, unreadPhotoSet] = await Promise.all([
      loadUnreadChats(userId, eventIds),
      loadUnreadPhotos(userId, eventIds),
    ]);
    setUnreadChats([...unreadChatSet]);
    setUnreadPhotos([...unreadPhotoSet]);
  }, [userId]);

  useEffect(() => {
    refresh();
    // Things change while the app is in the background; catch up on return.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // The app-icon number: unread chats, friend requests and invites, the same
  // things the server counts for notifications. Zero when signed out.
  const badge = userId ? unreadChats.length + friendRequests + pendingInvites : 0;
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

  return (
    <UnreadContext.Provider
      value={{
        unreadChats,
        unreadPhotos,
        friendRequests,
        pendingInvites,
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
