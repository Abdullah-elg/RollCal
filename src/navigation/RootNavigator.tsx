// All navigation: the signed-out stack, the signed-in stack, and the five
// tabs (the + opens CreateActionSheet instead of a screen). Also handles
// join links, notification taps, push registration and the loading splash.

import { BottomTabBarButtonProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as ExpoLinking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { WEB_ORIGIN } from '../lib/links';
import { ProPromptProvider } from '../context/ProPromptContext';
import { useUnread } from '../context/UnreadContext';
import { ArrowIcon } from '../components/icons';
import { CalendarBlank, Ticket, UserCircle, Users } from 'phosphor-react-native';
import CreateActionSheet from '../components/CreateActionSheet';
import AgePrompt, { needsAgeCheck } from '../components/AgePrompt';
import CurrencyPrompt from '../components/CurrencyPrompt';
import AgeBlockedScreen from '../screens/AgeBlockedScreen';
import { hapticLight } from '../lib/haptics';
import {
  ensurePushRegistered,
  NotificationTarget,
  onNotificationTap,
  onPushTokenChange,
  registerForPush,
} from '../lib/notifications';
import BillReviewScreen from '../screens/BillReviewScreen';
import BillScreen from '../screens/BillScreen';
import BillShareScreen from '../screens/BillShareScreen';
import CalendarScreen from '../screens/CalendarScreen';
import CreateEventScreen from '../screens/CreateEventScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import EventChatScreen from '../screens/EventChatScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import EventPhotosScreen from '../screens/EventPhotosScreen';
import RecapScreen from '../screens/RecapScreen';
import VideoRecapScreen from '../screens/VideoRecapScreen';
import BlockedPeopleScreen from '../screens/BlockedPeopleScreen';
import FindPeopleScreen from '../screens/FindPeopleScreen';
import FriendRequestsScreen from '../screens/FriendRequestsScreen';
import FriendsScreen from '../screens/FriendsScreen';
import LegalScreen from '../screens/LegalScreen';
import UpgradeScreen from '../screens/UpgradeScreen';
import { LEGAL } from '../legal/documents';
import PaymentMethodsScreen from '../screens/PaymentMethodsScreen';
import SentRequestsScreen from '../screens/SentRequestsScreen';
import EventInvitationsScreen from '../screens/EventInvitationsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import HostReportScreen from '../screens/HostReportScreen';
import HomeScreen from '../screens/HomeScreen';
import JoinEventScreen from '../screens/JoinEventScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import SupportScreen from '../screens/SupportScreen';
import LicensesScreen from '../screens/LicensesScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import VerifyEmailScreen from '../screens/VerifyEmailScreen';
import UpdateRequiredScreen from '../screens/UpdateRequiredScreen';
import { useMustUpdate } from '../lib/minVersion';
import { fonts, radii } from '../theme';
import { AppStackParamList, AuthStackParamList, TabParamList } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

// A small marker over a tab icon for anything unanswered.
function IconDot({ show, children }: { show: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View>
      {children}
      {show && (
        <View
          style={{
            position: 'absolute',
            top: -1,
            right: -3,
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: colors.danger,
            borderWidth: 1.5,
            borderColor: colors.paper,
          }}
        />
      )}
    </View>
  );
}

const EmptyTabScreen = () => null;

// The tab buttons without Android's grey ripple, so a tap looks the same as
// on iOS.
const TabButton = (props: BottomTabBarButtonProps) => (
  <PlatformPressable {...props} android_ripple={{ color: 'transparent' }} />
);

// Five tabs: Events, Calendar, +, Friends, Profile (Settings behind its gear).
// Tapping + intercepts navigation to open CreateActionSheet without switching tabs.
function TabsNavigator() {
  const { colors } = useTheme();
  const { unreadChats, friendRequests, pendingInvites, hostReports } = useUnread();
  const insets = useSafeAreaInsets();
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const navigation = useNavigation<any>();

  const tabBarBottom =
    Platform.OS === 'ios' ? Math.max(insets.bottom - 10, 0) : insets.bottom;

  return (
    <>
      <Tabs.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'none',
          tabBarButton: TabButton,
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.inkMuted,
          tabBarStyle: {
            backgroundColor: colors.paper,
            borderTopColor: colors.line,
            borderTopWidth: StyleSheet.hairlineWidth,
            // Same 52pt content row on both platforms. iOS reserves 34pt for
            // the home indicator, which pushed the row up; ~24pt matches the
            // space Android's gesture bar leaves.
            height: 52 + tabBarBottom,
            paddingBottom: tabBarBottom,
            paddingTop: 6,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarLabelStyle: {
            fontFamily: fonts.bodyMedium,
            fontSize: 10,
            letterSpacing: 0.1,
          },
        }}
      >
        <Tabs.Screen
          name="HomeTab"
          component={HomeScreen}
          options={{
            title: 'Events',
            tabBarIcon: ({ focused, color }) => (
              <IconDot show={unreadChats.length > 0 || pendingInvites > 0 || hostReports.length > 0}>
                <Ticket
                  size={22}
                  color={color}
                  weight={focused ? 'fill' : 'regular'}
                />
              </IconDot>
            ),
          }}
        />
        <Tabs.Screen
          name="CalendarTab"
          component={CalendarScreen}
          options={{
            title: 'Calendar',
            tabBarIcon: ({ focused, color }) => (
              <CalendarBlank
                size={22}
                color={color}
                weight={focused ? 'fill' : 'regular'}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="CreateTab"
          component={EmptyTabScreen}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              hapticLight();
              setCreateSheetOpen(true);
            },
          }}
          options={{
            // A + needs no caption, so it goes without one and is drawn a little larger.
            title: 'New',
            tabBarLabel: () => null,
            tabBarAccessibilityLabel: 'New',
            tabBarIcon: () => (
              <NewTabIcon tile={colors.accent} mark={colors.onAccent} />
            ),
            // With no label, centre the tile in the row instead of the icon slot.
            tabBarIconStyle: { flex: 1, justifyContent: 'center' },
          }}
        />
        <Tabs.Screen
          name="FriendsTab"
          component={FriendsScreen}
          options={{
            title: 'Friends',
            tabBarIcon: ({ focused, color }) => (
              <IconDot show={friendRequests > 0}>
                <Users
                  size={22}
                  color={color}
                  weight={focused ? 'fill' : 'regular'}
                />
              </IconDot>
            ),
          }}
        />
        <Tabs.Screen
          name="ProfileTab"
          component={ProfileScreen}
          options={{
            title: 'Profile',
            tabBarIcon: ({ focused, color }) => (
              <UserCircle
                size={22}
                color={color}
                weight={focused ? 'fill' : 'regular'}
              />
            ),
          }}
        />
      </Tabs.Navigator>

      <CreateActionSheet
        visible={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onNavigateNewEvent={() => navigation.navigate('CreateEvent')}
        onNavigateJoinEvent={() => navigation.navigate('JoinEvent')}
        onPhotosUploaded={(eventId) =>
          navigation.navigate('EventDetail', { eventId })
        }
      />
    </>
  );
}

// Deep links: https://rollcal.app/join/CODE (the shared link; opens the app
// when installed), rollcal://join/CODE, and exp://.../--/join/CODE in Expo Go.
// Opening one lands on the Join screen with the code prefilled.
// Only matches while signed in (the signed-out stack has no such route).
const linking = {
  prefixes: [ExpoLinking.createURL('/'), 'rollcal://', WEB_ORIGIN],
  config: {
    screens: {
      JoinEvent: 'join/:code',
      EventDetail: 'event/:eventId',
    },
  },
};

// The New tab is a small filled tile rather than a bare glyph, so it reads
// as the one action in a row of destinations. The + is two views sized in
// whole pixels, which keeps it exactly symmetrical on every screen density.
const TILE = PixelRatio.roundToNearestPixel(32);
const PLUS_THICKNESS = PixelRatio.roundToNearestPixel(2.5);
const PLUS_ARM = PixelRatio.roundToNearestPixel(6.5);
const PLUS_SIZE = PLUS_ARM * 2 + PLUS_THICKNESS;

function NewTabIcon({ tile, mark }: { tile: string; mark: string }) {
  const bar = {
    position: 'absolute' as const,
    backgroundColor: mark,
    borderRadius: 1,
  };
  return (
    <View
      style={{
        width: TILE,
        height: TILE,
        borderRadius: radii.control,
        backgroundColor: tile,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: PLUS_SIZE, height: PLUS_SIZE }}>
        <View
          style={[
            bar,
            {
              left: PLUS_ARM,
              top: 0,
              width: PLUS_THICKNESS,
              height: PLUS_SIZE,
            },
          ]}
        />
        <View
          style={[
            bar,
            {
              left: 0,
              top: PLUS_ARM,
              width: PLUS_SIZE,
              height: PLUS_THICKNESS,
            },
          ]}
        />
      </View>
    </View>
  );
}

export default function RootNavigator() {
  const { session, loading, recovering, ageBlocked } = useAuth();
  const { mode, colors } = useTheme();
  const updateRequired = useMustUpdate();

  // Paper background everywhere, including during screen transitions.
  const navTheme = useMemo(() => {
    const base = mode === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.paper,
        card: colors.paper,
        text: colors.ink,
        primary: colors.accent,
        border: colors.line,
      },
    };
  }, [mode, colors]);

  // Shared native-stack header styling so any screen with a header matches
  // the design language and the active theme.
  const headerOptions = useMemo(
    () =>
      ({
        headerStyle: { backgroundColor: colors.paper },
        headerTintColor: colors.ink,
        headerTitleStyle: {
          fontFamily: fonts.headingMedium,
          fontSize: 17,
          color: colors.ink,
        },
        headerShadowVisible: false,
      }) as const,
    [colors]
  );

  useEffect(() => {
    if (!loading) SplashScreen.hide();
  }, [loading]);

  // Tapping a notification opens what it's about: a bill, an event's chat,
  // the event (roll opening), a report to review as host, or Friends. If the tap launched the app,
  // navigation isn't ready yet, so it waits for onReady.
  const navRef = useNavigationContainerRef<AppStackParamList>();
  const pendingTarget = useRef<NotificationTarget | null>(null);
  const openPendingTarget = () => {
    const target = pendingTarget.current;
    if (!target || !navRef.isReady()) return;
    pendingTarget.current = null;
    if (target.kind === 'bill') navRef.navigate('Bill', { billId: target.billId });
    else if (target.kind === 'chat') {
      navRef.navigate('EventChat', { eventId: target.eventId, title: target.title });
    } else if (target.kind === 'event') {
      navRef.navigate('EventDetail', { eventId: target.eventId });
    } else if (target.kind === 'photos') {
      navRef.navigate('EventPhotos', { eventId: target.eventId });
    } else if (target.kind === 'hostReport') {
      navRef.navigate('HostReport', { reportId: target.reportId });
    } else navRef.navigate('Tabs', { screen: 'FriendsTab' });
  };
  // Keyed on the user, not the session object, which is replaced on every
  // token refresh.
  const tapUserId = session?.user.id;
  useEffect(() => {
    if (!tapUserId) return;
    return onNotificationTap((target) => {
      pendingTarget.current = target;
      openPendingTarget();
    });
    // openPendingTarget only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapUserId]);

  // Register this phone for push once signed in, and again if its token
  // changes.
  const signedInId = session?.user.id;
  useEffect(() => {
    if (!signedInId) return;
    registerForPush(signedInId);
    const stopTokenWatch = onPushTokenChange(signedInId);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') ensurePushRegistered(signedInId);
    });
    return () => {
      stopTokenWatch();
      appState.remove();
    };
  }, [signedInId]);

  // The native splash is still covering the screen while this renders.
  if (loading) return null;

  // This build is older than app_config's min_version.
  if (updateRequired) return <UpdateRequiredScreen />;

  return (
    <NavigationContainer
      ref={navRef}
      theme={navTheme}
      linking={linking}
      onReady={openPendingTarget}
    >
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {/* Mid password reset there's already a session; stay on the sign-in
          screens until the new password is saved. */}
      {session && !recovering && needsAgeCheck(session.user.user_metadata) ? (
        <AgePrompt />
      ) : session && !recovering ? (
        <ProPromptProvider
          onSeePro={(reason) => navRef.navigate('Upgrade', { reason })}
        >
          <AppStack.Navigator
            screenOptions={({ navigation }) => ({
              ...headerOptions,
              headerBackButtonDisplayMode: 'minimal',
              headerLeft: ({ canGoBack }) =>
                canGoBack ? (
                  <Pressable
                    onPress={() => navigation.goBack()}
                    hitSlop={12}
                    style={{
                      marginLeft: Platform.OS === 'ios' ? 8 : 0,
                      paddingVertical: 6,
                      paddingRight: 12,
                      justifyContent: 'center',
                    }}
                  >
                    <ArrowIcon size={20} color={colors.ink} direction="left" />
                  </Pressable>
                ) : null,
            })}
          >
            <AppStack.Screen
              name="Tabs"
              component={TabsNavigator}
              options={{ headerShown: false }}
            />
            <AppStack.Screen
              name="CreateEvent"
              component={CreateEventScreen}
              options={({ route }) => ({
                presentation: 'modal',
                title: route.params?.editEventId ? 'Manage event' : 'New event',
              })}
            />
            <AppStack.Screen
              name="EventDetail"
              component={EventDetailScreen}
              options={{ title: '' }}
            />
            <AppStack.Screen
              name="Recap"
              component={RecapScreen}
              options={{ title: 'Recap' }}
            />
            <AppStack.Screen
              name="VideoRecap"
              component={VideoRecapScreen}
              options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }}
            />
            <AppStack.Screen
              name="EventPhotos"
              component={EventPhotosScreen}
              options={{ title: '' }}
            />
            <AppStack.Screen
              name="EventChat"
              component={EventChatScreen}
              // A sideways drag on a message replies to it, so going back is
              // from the screen's edge only (iOS 26 otherwise lets the whole
              // screen swipe back).
              options={({ route }) => ({ title: route.params.title, fullScreenGestureEnabled: false })}
            />
            <AppStack.Screen
              name="JoinEvent"
              component={JoinEventScreen}
              options={{ presentation: 'modal', title: 'Join an event' }}
            />
            <AppStack.Screen
              name="EditProfile"
              component={EditProfileScreen}
              options={{ title: 'Edit profile' }}
            />
            <AppStack.Screen
              name="ChangePassword"
              component={ChangePasswordScreen}
              options={{ title: 'Password' }}
            />
            <AppStack.Screen
              name="PaymentMethods"
              component={PaymentMethodsScreen}
              options={{ title: 'Receiving methods' }}
            />
            <AppStack.Screen
              name="Upgrade"
              component={UpgradeScreen}
              options={{ title: 'Plans' }}
            />
            <AppStack.Screen
              name="Legal"
              component={LegalScreen}
              options={({ route }) => ({
                title: LEGAL[route.params.doc].title,
              })}
            />
            <AppStack.Screen
              name="BillReview"
              component={BillReviewScreen}
              options={({ route }) => ({
                title: route.params.editBillId
                  ? 'Edit bill'
                  : route.params.draft
                    ? 'Check the bill'
                    : 'New bill',
              })}
            />
            <AppStack.Screen
              name="BillShare"
              component={BillShareScreen}
              options={{ title: 'Share bill' }}
            />
            <AppStack.Screen
              name="Bill"
              component={BillScreen}
              options={{ title: '' }}
            />
            <AppStack.Screen
              name="BlockedPeople"
              component={BlockedPeopleScreen}
              options={{ title: 'Blocked people' }}
            />
            <AppStack.Screen
              name="Support"
              component={SupportScreen}
              options={{ title: 'Support' }}
            />
            <AppStack.Screen
              name="Licenses"
              component={LicensesScreen}
              options={{ title: 'Open-source licences' }}
            />
            <AppStack.Screen
              name="FindPeople"
              component={FindPeopleScreen}
              options={{ title: 'Search users' }}
            />
            <AppStack.Screen
              name="FriendRequests"
              component={FriendRequestsScreen}
              options={{ title: 'Friend requests' }}
            />
            <AppStack.Screen
              name="SentRequests"
              component={SentRequestsScreen}
              options={{ title: 'Sent requests' }}
            />
            <AppStack.Screen
              name="EventInvitations"
              component={EventInvitationsScreen}
              options={{ title: 'Invitations' }}
            />
            <AppStack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: 'Settings' }}
            />
            <AppStack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ title: 'Notifications' }}
            />
            <AppStack.Screen
              name="HostReport"
              component={HostReportScreen}
              options={{ title: 'Reported to you' }}
            />
          </AppStack.Navigator>
          <CurrencyPrompt />
        </ProPromptProvider>
      ) : ageBlocked ? (
        <AgeBlockedScreen />
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="SignIn" component={SignInScreen} />
          <AuthStack.Screen name="SignUp" component={SignUpScreen} />
          <AuthStack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
          <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}
