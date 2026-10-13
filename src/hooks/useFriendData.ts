import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';
import { animateNext } from '../lib/animate';
import { EMPTY_FRIEND_DATA, FriendData, loadFriendData } from '../lib/friends';
import { hapticLight } from '../lib/haptics';
import { notifyFriendActivity } from '../lib/notifications';

// Friends, incoming requests and sent requests, reloaded whenever the screen
// comes into focus - so counts stay right after acting on another page.
export function useFriendData() {
  const { session } = useAuth();
  const { refresh: refreshUnread } = useUnread();
  const userId = session!.user.id;
  const [data, setData] = useState<FriendData>(EMPTY_FRIEND_DATA);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  const reload = useCallback(async () => {
    const next = await loadFriendData(userId);
    animateNext(hasLoadedRef.current);
    setData(next);
    setLoaded(true);
    hasLoadedRef.current = true;
    // New requests and acceptances can only be spotted when we fetch, so
    // this is where friend notifications get raised.
    notifyFriendActivity(userId, next);
    // Keeps the Friends tab dot in step with what's on screen.
    refreshUnread();
  }, [userId, refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const refresh = useCallback(async () => {
    hapticLight();
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  return { userId, data, loaded, refreshing, refresh, reload };
}
