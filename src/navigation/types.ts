// Route params for each navigator. Grows as stages add screens.

import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LegalDoc } from '../legal/documents';
import { BillDraft } from '../lib/bills';
import { PlanId, UpgradeReason } from '../lib/pro';

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  VerifyEmail: { email: string };
  ForgotPassword: { email?: string } | undefined;
  ResetPassword: { email: string };
};

// The bottom tabs live inside the app stack, so pushed screens (event
// detail, forms, settings) cover the tab bar.
export type TabParamList = {
  HomeTab: undefined;
  CalendarTab: undefined;
  CreateTab: undefined;
  FriendsTab: undefined;
  ProfileTab: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  // With editEventId the same form edits an existing event (host only).
  CreateEvent: { editEventId?: string; initialDate?: string } | undefined;
  EventDetail: { eventId: string };
  // Every photo in an event. From a Memory it also offers "Go to event".
  EventPhotos: { eventId: string; fromMemories?: boolean };
  // The shareable recap picture of an event.
  Recap: { eventId: string };
  // The recap played back like a story (photos with a slow zoom).
  // savedPath: play the event's saved recap file instead of building it.
  VideoRecap: { eventId: string; mode?: 'all' | 'highlights'; savedPath?: string };
  EventChat: { eventId: string; title: string };
  JoinEvent: { code?: string; openScanner?: boolean } | undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  PaymentMethods: undefined;
  // The plans screen; reason is where the person came from.
  // plan wins over reason for which card opens; eventId is for Event Pass.
  Upgrade: { reason?: UpgradeReason; plan?: PlanId; eventId?: string } | undefined;
  Legal: { doc: LegalDoc };
  // Bill splitting. BillReview is where a bill is typed in or a scanned one
  // is checked; BillShare picks payment methods and shares it; Bill shows a
  // shared bill.
  // With editBillId, changes an already shared bill instead of making one.
  // receivedCents is what's been paid on it so far.
  BillReview: { eventId: string; draft?: BillDraft; editBillId?: string; receivedCents?: number };
  BillShare: { draft: BillDraft };
  // pickOnly: opened from "Pay together" just to choose your part.
  Bill: { billId: string; pickOnly?: boolean };
  FindPeople: undefined;
  FriendRequests: undefined;
  SentRequests: undefined;
  EventInvitations: undefined;
  Notifications: undefined;
  // A photo or video reported to you as the event's host.
  HostReport: { reportId: string };
  BlockedPeople: undefined;
  Support: { message?: string } | undefined;
  Licenses: undefined;
  // Behind the gear on the Profile tab.
  Settings: undefined;
};

// Tab screens can navigate to stack routes too, so their props compose both.
export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
