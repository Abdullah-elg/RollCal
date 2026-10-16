// Route params for each navigator. Grows as stages add screens.

import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LegalDoc } from '../legal/documents';
import { BillDraft } from '../lib/bills';
import { UpgradeReason } from '../lib/pro';

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  VerifyEmail: { email: string };
};

// The bottom tabs live inside the app stack, so pushed screens (event
// detail, forms, settings) cover the tab bar.
export type TabParamList = {
  HomeTab: undefined;
  CalendarTab: undefined;
  CreateTab: undefined;
  FriendsTab: undefined;
  SettingsTab: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  // With editEventId the same form edits an existing event (host only).
  CreateEvent: { editEventId?: string; initialDate?: string } | undefined;
  EventDetail: { eventId: string };
  EventChat: { eventId: string; title: string };
  JoinEvent: { code?: string; openScanner?: boolean } | undefined;
  EditProfile: undefined;
  PaymentMethods: undefined;
  // SociaLink Pro; reason is where the person came from.
  Upgrade: { reason?: UpgradeReason } | undefined;
  Legal: { doc: LegalDoc };
  // Bill splitting. BillReview is where a bill is typed in or a scanned one
  // is checked; BillShare picks payment methods and shares it; Bill shows a
  // shared bill.
  BillReview: { eventId: string; draft?: BillDraft };
  BillShare: { draft: BillDraft };
  Bill: { billId: string };
  FindPeople: undefined;
  FriendRequests: undefined;
  SentRequests: undefined;
  EventInvitations: undefined;
};

// Tab screens can navigate to stack routes too, so their props compose both.
export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
