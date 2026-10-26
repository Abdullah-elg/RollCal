// Edit first and last name, username and profile photo. Usernames are
// unique, so a taken one is caught and reported.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Avatar from '../components/Avatar';
import { CameraIcon } from '../components/icons';
import { Button, ErrorText, Field, FormScreen } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { pickAndUploadAvatar, removeAvatar } from '../lib/avatar';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { cleanUsername, usernameProblem } from '../lib/username';
import { supabase } from '../lib/supabase';
import { AppStackParamList } from '../navigation/types';
import { Palette, spacing, TypeTokens } from '../theme';
import { NAME_MAX } from '../lib/limits';

type Props = NativeStackScreenProps<AppStackParamList, 'EditProfile'>;


export default function EditProfileScreen({ navigation }: Props) {
  const { session, profile, refreshProfile } = useAuth();
  const { colors, type } = useTheme();
  const styles = useMemo(() => makeStyles(colors, type), [colors, type]);
  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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

  const save = async () => {
    const newUsername = cleanUsername(username);
    const problem = usernameProblem(newUsername);
    if (problem) {
      setError(`Username: ${problem}`);
      return;
    }
    setError(null);
    setBusy(true);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        username: newUsername,
      })
      .eq('id', session!.user.id);
    setBusy(false);
    if (updateError) {
      // 23505 = the unique index on username caught a duplicate.
      setError(
        updateError.code === '23505'
          ? 'That username is taken. Try another.'
          : updateError.message
      );
      return;
    }
    hapticSuccess();
    await refreshProfile();
    navigation.goBack();
  };

  return (
    <FormScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.avatarSection}>
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
              username={profile?.username}
              avatarUrl={profile?.avatar_url}
              size={84}
            />
            {uploadingAvatar ? (
              <View style={styles.avatarLoadingOverlay}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : (
              <View style={styles.cameraBadge}>
                <CameraIcon size={14} color="#FFFFFF" />
              </View>
            )}
          </Pressable>
          <Pressable onPress={handleAvatarPress} hitSlop={8}>
            <Text style={styles.changePhotoText}>
              {profile?.avatar_url ? 'Change photo' : 'Add photo'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.nameRow}>
          <View style={{ flex: 1 }}>
            <Field
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              autoComplete="given-name"
              maxLength={NAME_MAX}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              autoComplete="family-name"
              maxLength={NAME_MAX}
            />
          </View>
        </View>
        <Field
          label="Username"
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase())}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
        />
        <Text style={[type.caption, { marginTop: -spacing.sm, marginBottom: spacing.md }]}>
          Unique to you. It's how friends find you. Letters, numbers, dots,
          dashes or underscores.
        </Text>
        <ErrorText message={error} />
        <Button
          title="Save"
          onPress={save}
          loading={busy}
          disabled={!firstName.trim() || !lastName.trim() || !username.trim()}
        />
      </ScrollView>
    </FormScreen>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    },
    content: {
      padding: spacing.lg,
    },
    avatarSection: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
      gap: spacing.xs,
    },
    avatarPressable: {
      position: 'relative',
    },
    cameraBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.paper,
    },
    avatarLoadingOverlay: {
      ...StyleSheet.absoluteFill,
      borderRadius: 42,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    changePhotoText: {
      ...t.button,
      color: c.accent,
      marginTop: 4,
    },
    nameRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
  });
