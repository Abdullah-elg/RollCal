// Route params for each navigator. Grows as stages add screens.

import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
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
