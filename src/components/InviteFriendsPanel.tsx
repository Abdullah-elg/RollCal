// The invite page of the event sheet. Hosts invite friends directly and
// withdraw invitations. Other attendees ask the host to invite someone, and
// the host approves or declines those requests.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useFriendData } from '../hooks/useFriendData';
import { animateNext } from '../lib/animate';
import { hapticLight } from '../lib/haptics';
import {
  approveInviteRequest,
  declineInviteRequest,
  EventInvitation,
  inviteFriend,
  loadEventInvitations,
  loadMyInviteRequests,
  loadPendingInviteRequests,
  PendingInviteRequestItem,
  removeInvitation,
  requestInviteFriend,
  withdrawInviteRequest,
} from '../lib/invitations';
import { Palette, radii, spacing, TypeTokens } from '../theme';
import { PeopleIcon } from './icons';
import { PersonList, PersonRow, RowAction, RowTag } from './PersonRow';
import { EmptyNote, PageIntro, SectionLabel } from './ui';

type Props = {
  eventId: string;
  userId: string;
  isLeader: boolean;
  // Lets the event screen refresh its own "Invited" list behind the sheet.
  onChanged: () => void;
};

const STATUS_TAG = {
  pending: 'Invited',
  accepted: 'Coming',
  declined: 'Declined',
} as const;

export default function InviteFriendsPanel({
  eventId,
  userId,
  isLeader,
  onChanged,
}: Props) {
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const { data: friends, loaded: friendsLoaded } = useFriendData();
  const [invites, setInvites] = useState<EventInvitation[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingInviteRequestItem[]>([]);
  const [myRequests, setMyRequests] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const loadInvites = useCallback(async () => {
    const rows = await loadEventInvitations(eventId);
    animateNext(hasLoadedRef.current);
    setInvites(rows);

    if (isLeader) {
      const reqs = await loadPendingInviteRequests(eventId);
      setPendingRequests(reqs);
    } else {
      const myReqIds = await loadMyInviteRequests(eventId, userId);
      setMyRequests(myReqIds);
    }

    setInvitesLoaded(true);
    hasLoadedRef.current = true;
  }, [eventId, isLeader, userId]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const invitationFor = (friendId: string) =>
    invites.find((i) => i.profile.id === friendId);

  // Leader directly invites
  const invite = async (friendId: string, name: string) => {
    hapticLight();
    const err = await inviteFriend(eventId, friendId, userId);
    setNotice(err ?? `Invited ${name}.`);
    await loadInvites();
    onChanged();
  };

  // Leader withdraws invitation
  const withdraw = async (invitationId: string) => {
    hapticLight();
    const err = await removeInvitation(invitationId);
    if (err) setNotice(err);
    await loadInvites();
    onChanged();
  };

  // Attendee requests host to invite a friend
  const handleRequestInvite = async (friendId: string, name: string) => {
    hapticLight();
    const err = await requestInviteFriend(eventId, friendId, userId);
    if (err) {
      setNotice(err);
    } else {
      setNotice(`Requested invite for ${name}. The host will review it.`);
    }
    await loadInvites();
    onChanged();
  };

  // Attendee withdraws their request
  const handleWithdrawRequest = async (friendId: string) => {
    hapticLight();
    const err = await withdrawInviteRequest(eventId, friendId, userId);
    if (err) setNotice(err);
    await loadInvites();
    onChanged();
  };

  // Leader approves member's request
  const handleApproveRequest = async (requestId: string, name: string) => {
    hapticLight();
    const err = await approveInviteRequest(requestId);
    if (err) setNotice(err);
    else setNotice(`Approved invitation for ${name}.`);
    await loadInvites();
    onChanged();
  };

  // Leader declines member's request
  const handleDeclineRequest = async (requestId: string) => {
    hapticLight();
    const err = await declineInviteRequest(requestId);
    if (err) setNotice(err);
    await loadInvites();
    onChanged();
  };

  return (
    <>
      <PageIntro icon={PeopleIcon}>
        {isLeader ? 'Invite friends to this event' : 'Request to invite friends'}
      </PageIntro>
      <Text style={[type.bodyMuted, { marginBottom: spacing.lg }]}>
        {isLeader
          ? 'Invite your friends directly or accept requests from guests.'
          : 'Ask the host to invite your friends. Once accepted, an invitation will be sent to them.'}
      </Text>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {isLeader && pendingRequests.length > 0 && (
        <View style={{ marginBottom: spacing.xl }}>
          <SectionLabel count={pendingRequests.length}>
            Invite requests
          </SectionLabel>
          <PersonList>
            {pendingRequests.map((req) => (
              <PersonRow
                key={req.id}
                person={req.suggestedUser}
                subtitle={`Requested by ${req.requester.display_name}`}
              >
                <RowAction
                  label="Accept"
                  onPress={() =>
                    handleApproveRequest(req.id, req.suggestedUser.display_name)
                  }
                />
                <RowAction
                  label="Decline"
                  tone="muted"
                  onPress={() => handleDeclineRequest(req.id)}
                />
              </PersonRow>
            ))}
          </PersonList>
        </View>
      )}

      <SectionLabel count={friends.friends.length}>Your friends</SectionLabel>
      {!friendsLoaded || !invitesLoaded ? (
        <ActivityIndicator color={colors.accent} />
      ) : friends.friends.length === 0 ? (
        <EmptyNote>
          You haven't added anyone yet. Friends you add on the Friends tab show
          up here, ready to invite.
        </EmptyNote>
      ) : (
        <PersonList>
          {friends.friends.map((link) => {
            const existing = invitationFor(link.profile.id);
            const isRequested = myRequests.includes(link.profile.id);

            return (
              <PersonRow key={link.friendshipId} person={link.profile}>
                {existing ? (
                  existing.invitation.status === 'pending' ? (
                    <>
                      <RowTag label={STATUS_TAG.pending} />
                      {isLeader && (
                        <RowAction
                          label="Withdraw"
                          tone="muted"
                          onPress={() => withdraw(existing.invitation.id)}
                        />
                      )}
                    </>
                  ) : (
                    <RowTag label={STATUS_TAG[existing.invitation.status]} />
                  )
                ) : !isLeader ? (
                  isRequested ? (
                    <>
                      <RowTag label="Requested" />
                      <RowAction
                        label="Withdraw"
                        tone="muted"
                        onPress={() => handleWithdrawRequest(link.profile.id)}
                      />
                    </>
                  ) : (
                    <RowAction
                      label="Request"
                      onPress={() =>
                        handleRequestInvite(
                          link.profile.id,
                          link.profile.display_name
                        )
                      }
                    />
                  )
                ) : (
                  <RowAction
                    label="Invite"
                    onPress={() =>
                      invite(link.profile.id, link.profile.display_name)
                    }
                  />
                )}
              </PersonRow>
            );
          })}
        </PersonList>
      )}
    </>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    notice: {
      ...t.caption,
      color: c.ink,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radii.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
  });
