import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigation,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as ExpoLinking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useUnread } from '../context/UnreadContext';
import { ArrowIcon } from '../components/icons';
import { CalendarBlank, Gear, Plus, Ticket, Users } from 'phosphor-react-native';
import CreateActionSheet from '../components/CreateActionSheet';
import { hapticLight } from '../lib/haptics';
import CalendarScreen from '../screens/CalendarScreen';
import CreateEventScreen from '../screens/CreateEventScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import EventChatScreen from '../screens/EventChatScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import FindPeopleScreen from '../screens/FindPeopleScreen';
import FriendRequestsScreen from '../screens/FriendRequestsScreen';
import FriendsScreen from '../screens/FriendsScreen';
import SentRequestsScreen from '../screens/SentRequestsScreen';
import EventInvitationsScreen from '../screens/EventInvitationsScreen';
import HomeScreen from '../screens/HomeScreen';
import JoinEventScreen from '../screens/JoinEventScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import { fonts } from '../theme';
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

// Five tabs: Events, Calendar, +, Friends, Settings.
// Tapping + intercepts navigation to open CreateActionSheet without switching tabs.
function TabsNavigator() {
  const { colors } = useTheme();
  const { unreadChats, friendRequests, pendingInvites } = useUnread();
  const insets = useSafeAreaInsets();
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const navigation = useNavigation<any>();

  return (
    <>
      <Tabs.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'none',
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.inkMuted,
          tabBarStyle: {
            backgroundColor: colors.paper,
            borderTopColor: colors.line,
            borderTopWidth: StyleSheet.hairlineWidth,
            height: 52 + insets.bottom,
            paddingBottom: insets.bottom,
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
              <IconDot show={unreadChats.length > 0 || pendingInvites > 0}>
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
            title: 'New',
            tabBarIcon: () => (
              <Plus size={22} color={colors.accent} weight="bold" />
            ),
            tabBarLabel: () => (
              <Text
                style={{
                  fontFamily: fonts.bodyMedium,
                  fontSize: 10,
                  letterSpacing: 0.1,
                  color: colors.accent,
                }}
              >
                New
              </Text>
            ),
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
          name="SettingsTab"
          component={SettingsScreen}
          options={{
            title: 'Settings',
            tabBarIcon: ({ focused, color }) => (
              <Gear
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
        onPhotosUploaded={(eventId) => navigation.navigate('EventDetail', { eventId })}
      />
    </>
  );
}

// Deep links: exp://.../--/join/CODE in Expo Go, socialink://join/CODE in a
// real build. Opening one lands on the Join screen with the code prefilled.
// Only matches while signed in (the signed-out stack has no such route).
const linking = {
  prefixes: [ExpoLinking.createURL('/'), 'socialink://'],
  config: {
    screens: {
      JoinEvent: 'join/:code',
      EventDetail: 'event/:eventId',
    },
  },
};

export default function RootNavigator() {
  const { session, loading } = useAuth();
  const { mode, colors } = useTheme();

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

  // While the persisted session restores, hold the paper background
  // instead of flashing the login screen.
  if (loading) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {session ? (
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
              title: route.params?.editEventId ? 'Edit event' : 'New event',
            })}
          />
          <AppStack.Screen
            name="EventDetail"
            component={EventDetailScreen}
            options={{ title: '' }}
          />
          <AppStack.Screen
            name="EventChat"
            component={EventChatScreen}
            options={({ route }) => ({ title: route.params.title })}
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
        </AppStack.Navigator>
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="SignIn" component={SignInScreen} />
          <AuthStack.Screen name="SignUp" component={SignUpScreen} />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}
