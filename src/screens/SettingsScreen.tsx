import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import ConfirmDialog from '../components/ConfirmDialog';
import { CameraIcon, ChevronRightIcon } from '../components/icons';
import { Button, ThemedSwitch } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { pickAndUploadAvatar, removeAvatar } from '../lib/avatar';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import {
  ALBUM_PREF_KEYS,
  CHAT_PREF_KEYS,
  ensureNotificationPermission,
  EVENT_PREF_KEYS,
  FRIEND_PREF_KEYS,
  getReminderPrefs,
  notificationsAvailable,
  ReminderPrefs,
  setReminderPrefs,
  syncEventReminders,
} from '../lib/notifications';
import { TabScreenProps } from '../navigation/types';
import {
  floatingTabBar,
  fonts,
  Palette,
  radii,
  spacing,
  TypeTokens,
} from '../theme';

type Props = TabScreenProps<'SettingsTab'>;

type RowProps = {
  label: string;
  caption?: string;
  value: boolean;
  onToggle: (next: boolean) => void;
};

type ToggleRow = { key: keyof ReminderPrefs; label: string; caption?: string };

// Each sheet's toggles, in the order they fire.
const EVENT_ROWS: ToggleRow[] = [
  { key: 'dayBefore', label: '1 day before' },
  { key: 'hourBefore', label: '1 hour before' },
  { key: 'thirtyMin', label: '30 minutes before' },
  { key: 'fiveMin', label: '5 minutes before' },
  { key: 'atStart', label: 'When the event starts' },
];

const ALBUM_ROWS: ToggleRow[] = [
  {
    key: 'albumOpen',
    label: 'When the album opens',
    caption: 'When the event ends and photo uploads begin',
  },
  { key: 'albumDayLeft', label: '1 day till it closes' },
  { key: 'albumHourLeft', label: '1 hour till it closes' },
  { key: 'albumClosed', label: 'When it closes' },
];

const FRIEND_ROWS: ToggleRow[] = [
  {
    key: 'friendRequest',
    label: 'New friend requests',
    caption: 'When someone adds you',
  },
  { key: 'friendAccepted', label: 'Requests accepted' },
  {
    key: 'eventInvite',
    label: 'Event invitations',
    caption: 'When a friend invites you to an event',
  },
];

const CHAT_ROWS: ToggleRow[] = [
  {
    key: 'chatMessage',
    label: 'New messages',
    caption: "From events you're part of",
  },
];

// Defined out here on purpose. Declared inside the screen, it would be a
// brand-new component type on every render, so toggling one switch would
// unmount and remount every other row - replaying their switch animations.
function SettingRow({ label, caption, value, onToggle }: RowProps) {
  const { type } = useTheme();
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.text}>
        <Text style={type.body}>{label}</Text>
        {caption ? <Text style={type.caption}>{caption}</Text> : null}
      </View>
      <ThemedSwitch value={value} onValueChange={onToggle} />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});

export default function SettingsScreen({ navigation }: Props) {
  const { session, profile, signOut, refreshProfile } = useAuth();
  const { mode, preference, setPreference, colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [prefs, setPrefsState] = useState<ReminderPrefs | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [openSheet, setOpenSheet] = useState<
    'event' | 'album' | 'friend' | 'chat' | null
  >(null);

  const handleAvatarPress = () => {
    if (uploadingAvatar || !session?.user.id) return;
    hapticLight();

    const doUpload = async () => {
      setUploadingAvatar(true);
      const res = await pickAndUploadAvatar(session.user.id);
      setUploadingAvatar(false);
      if (res.error) {
        Alert.alert('Profile photo', res.error);
      } else if (res.url) {
        hapticSuccess();
        await refreshProfile();
      }
    };

    const doRemove = async () => {
      setUploadingAvatar(true);
      const res = await removeAvatar(session.user.id);
      setUploadingAvatar(false);
      if (res.error) {
        Alert.alert('Profile photo', res.error);
      } else {
        hapticSuccess();
        await refreshProfile();
      }
    };

    if (profile?.avatar_url) {
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Cancel', 'Choose photo', 'Remove photo'],
            destructiveButtonIndex: 2,
            cancelButtonIndex: 0,
            title: 'Profile photo',
          },
          (buttonIndex) => {
            if (buttonIndex === 1) doUpload();
            else if (buttonIndex === 2) doRemove();
          }
        );
      } else {
        Alert.alert('Profile photo', undefined, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Choose photo', onPress: doUpload },
          { text: 'Remove photo', style: 'destructive', onPress: doRemove },
        ]);
      }
    } else {
      doUpload();
    }
  };

  useEffect(() => {
    getReminderPrefs().then(setPrefsState);
  }, []);

  const toggleReminder = async (key: keyof ReminderPrefs, next: boolean) => {
    if (!prefs) return;
    // Where notifications can't run at all (Expo Go on Android), still save
    // the choice - it takes effect in a development build.
    if (next && notificationsAvailable) {
      const granted = await ensureNotificationPermission();
      setPermissionDenied(!granted);
      if (!granted) return;
    }
    const updated = { ...prefs, [key]: next };
    setPrefsState(updated);
    await setReminderPrefs(updated);
    // Recompute the device's scheduled reminders with the new prefs.
    syncEventReminders();
  };

  // "2 on" style summary for the collapsed rows.
  const countOn = (keys: (keyof ReminderPrefs)[]) =>
    prefs ? keys.filter((k) => prefs[k]).length : 0;

  const sheetRows =
    openSheet === 'album'
      ? ALBUM_ROWS
      : openSheet === 'friend'
        ? FRIEND_ROWS
        : openSheet === 'chat'
          ? CHAT_ROWS
          : EVENT_ROWS;

  const insets = useSafeAreaInsets();
  const bottomInset =
    Platform.OS === 'ios'
      ? insets.bottom + floatingTabBar.height + floatingTabBar.bottomGap
      : 0;

  const handleSelectPreference = (opt: 'system' | 'light' | 'dark') => {
    hapticLight();
    setPreference(opt);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={type.title}>Settings</Text>
      </View>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomInset + spacing.xxl },
        ]}
      >
        <Text style={[styles.sectionLabel, styles.firstSectionLabel]}>Appearance</Text>
        <View style={styles.card}>
          <Text style={type.body}>Theme</Text>
          <Text style={[type.caption, { marginTop: 2, marginBottom: spacing.md }]}>
            {preference === 'system'
              ? `Following phone settings (${mode === 'dark' ? 'Dark' : 'Light'})`
              : preference === 'dark'
                ? 'Dark mode active'
                : 'Light mode active'}
          </Text>
          <View style={styles.themeToggle}>
            {(['system', 'light', 'dark'] as const).map((opt) => (
              <Pressable
                key={opt}
                onPress={() => handleSelectPreference(opt)}
                style={[
                  styles.themeToggleOption,
                  preference === opt && styles.themeToggleActive,
                ]}
              >
                <Text
                  style={[
                    styles.themeToggleText,
                    preference === opt && { color: colors.onAccent },
                  ]}
                >
                  {opt === 'system' ? 'System' : opt === 'light' ? 'Light' : 'Dark'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Notifications</Text>
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => setOpenSheet('event')}
          >
            <View style={styles.rowText}>
              <Text style={type.body}>Event reminders</Text>
              <Text style={type.caption}>
                {countOn([...EVENT_PREF_KEYS])} of {EVENT_PREF_KEYS.length} on
              </Text>
            </View>
            <ChevronRightIcon size={16} color={colors.inkMuted} />
          </Pressable>
          <View style={styles.rowDivider} />
          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => setOpenSheet('album')}
          >
            <View style={styles.rowText}>
              <Text style={type.body}>Photo album reminders</Text>
              <Text style={type.caption}>
                {countOn([...ALBUM_PREF_KEYS])} of {ALBUM_PREF_KEYS.length} on
              </Text>
            </View>
            <ChevronRightIcon size={16} color={colors.inkMuted} />
          </Pressable>
          <View style={styles.rowDivider} />
          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => setOpenSheet('friend')}
          >
            <View style={styles.rowText}>
              <Text style={type.body}>Friends</Text>
              <Text style={type.caption}>
                {countOn([...FRIEND_PREF_KEYS])} of {FRIEND_PREF_KEYS.length} on
              </Text>
            </View>
            <ChevronRightIcon size={16} color={colors.inkMuted} />
          </Pressable>
          <View style={styles.rowDivider} />
          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => setOpenSheet('chat')}>
            <View style={styles.rowText}>
              <Text style={type.body}>Chat</Text>
              <Text style={type.caption}>
                {countOn([...CHAT_PREF_KEYS])} of {CHAT_PREF_KEYS.length} on
              </Text>
            </View>
            <ChevronRightIcon size={16} color={colors.inkMuted} />
          </Pressable>
        </View>
      {permissionDenied && (
        <Text style={styles.permissionHint}>
          Notifications are blocked for this app. Allow them in your phone's
          system settings, then try again.
        </Text>
      )}
      <Text style={[type.caption, { marginTop: spacing.sm }]}>
        {notificationsAvailable
          ? "Reminders are scheduled on this device for events you're part of."
          : "Expo Go on Android can't deliver notifications. Your choices are saved and will start working in a development build."}
      </Text>

      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.card}>
        <View style={styles.profileHeaderRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            onPress={handleAvatarPress}
            style={({ pressed }) => [
              styles.avatarPressable,
              pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
            ]}
          >
            <Avatar
              userId={profile?.id}
              name={profile?.display_name}
              avatarUrl={profile?.avatar_url}
              size={64}
            />
            {uploadingAvatar ? (
              <View style={styles.avatarLoadingOverlay}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : (
              <View style={styles.cameraBadge}>
                <CameraIcon size={12} color="#FFFFFF" />
              </View>
            )}
          </Pressable>

          <View style={styles.profileInfoCol}>
            <Text style={styles.profileDisplayName} numberOfLines={1}>
              {profile?.display_name}
            </Text>
            {profile?.username ? (
              <Text style={styles.profileUsername} numberOfLines={1}>
                @{profile.username}
              </Text>
            ) : null}
            <Text style={styles.profileEmail} numberOfLines={1}>
              {session?.user.email}
            </Text>
          </View>
        </View>

        <Button
          title="Edit profile"
          variant="secondary"
          onPress={() => navigation.navigate('EditProfile')}
          style={{ marginTop: spacing.md }}
        />
        <Pressable
          onPress={() => setConfirmLogout(true)}
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>

      {/* Reminder toggles live in their own slide-up sheet, one per group. */}
      <Modal
        visible={openSheet !== null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS === 'android'}
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={() => setOpenSheet(null)}
      >
        <View style={Platform.OS === 'android' ? styles.sheetOverlay : { flex: 1 }}>
          <SafeAreaView
            style={[
              styles.screen,
              Platform.OS === 'android' && styles.androidSheetCard,
            ]}
            edges={['bottom']}
          >
            {Platform.OS === 'android' && (
              <View style={styles.sheetHandleBar}>
                <View style={styles.sheetHandle} />
              </View>
            )}
            <View style={styles.sheetHeader}>
              <Text style={type.h2}>
                {openSheet === 'album'
                  ? 'Album reminders'
                  : openSheet === 'friend'
                    ? 'Friend notifications'
                    : openSheet === 'chat'
                      ? 'Chat notifications'
                      : 'Event reminders'}
              </Text>
              <Pressable onPress={() => setOpenSheet(null)} hitSlop={8}>
                <Text style={styles.sheetDone}>Done</Text>
              </Pressable>
            </View>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[type.bodyMuted, { marginBottom: spacing.md }]}>
              {openSheet === 'album'
                ? 'Nudges around the 48 hours the album stays open for uploads.'
                : openSheet === 'friend'
                  ? 'Friend activity happens on other people’s phones, so these arrive when you next open the app.'
                  : openSheet === 'chat'
                    ? 'A single event can be muted on its own. Open its chat and tap the bell.'
                    : 'Nudges in the run-up to an event you’re part of.'}
            </Text>
            <View style={styles.card}>
              {prefs &&
                sheetRows.map((row, i) => (
                  <View key={row.key}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    <SettingRow
                      label={row.label}
                      caption={row.caption}
                      value={prefs[row.key]}
                      onToggle={(v) => toggleReminder(row.key, v)}
                    />
                  </View>
                ))}
            </View>
            {permissionDenied && (
              <Text style={styles.permissionHint}>
                Notifications are blocked for this app. Allow them in your
                phone's system settings, then try again.
              </Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>

      <ConfirmDialog
        visible={confirmLogout}
        title="Log out?"
        message="Your events and albums will be right here when you come back."
        confirmLabel="Log out"
        cancelLabel="Stay"
        destructive
        onConfirm={() => {
          setConfirmLogout(false);
          signOut();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </ScrollView>
  </SafeAreaView>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    sectionLabel: {
      ...t.body,
      fontSize: 15,
      color: c.inkMuted,
      marginBottom: spacing.sm,
      marginTop: spacing.lg,
    },
    firstSectionLabel: {
      marginTop: 0,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: spacing.md,
    },
    themeToggle: {
      flexDirection: 'row',
      backgroundColor: c.paper,
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      overflow: 'hidden',
    },
    themeToggleOption: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeToggleActive: {
      backgroundColor: c.accent,
    },
    themeToggleText: {
      ...t.caption,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: 4,
    },
    profileHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.xs,
    },
    avatarPressable: {
      position: 'relative',
    },
    cameraBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.card,
    },
    avatarLoadingOverlay: {
      ...StyleSheet.absoluteFill,
      borderRadius: 32,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileInfoCol: {
      flex: 1,
      justifyContent: 'center',
    },
    profileDisplayName: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    profileUsername: {
      ...t.caption,
      color: c.inkMuted,
      marginTop: 1,
    },
    profileEmail: {
      ...t.caption,
      color: c.inkMuted,
      marginTop: 2,
    },
    logoutBtn: {
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoutText: {
      ...t.button,
      color: c.danger,
    },
    sheetOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
    },
    androidSheetCard: {
      marginTop: (RNStatusBar.currentHeight ?? 24) + 12,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      overflow: 'hidden',
    },
    sheetHandleBar: {
      alignItems: 'center',
      paddingTop: spacing.sm,
      paddingBottom: 2,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.line,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: Platform.OS === 'android' ? spacing.xs : spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    sheetDone: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
      marginVertical: spacing.sm,
    },
    permissionHint: {
      ...t.caption,
      color: c.danger,
      marginTop: spacing.sm,
    },
  });
