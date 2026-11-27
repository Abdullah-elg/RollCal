// Your own profile photo with a camera badge: tap to choose a photo, or,
// when you have one, to choose another or remove it. Used on the Profile
// tab and in Settings.

import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { pickAndUploadAvatar, removeAvatar } from '../lib/avatar';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import ActionMenuSheet from './ActionMenuSheet';
import Avatar from './Avatar';
import { CameraIcon } from './icons';

type Props = {
  size: number;
  // What's behind the badge, so its ring blends in.
  backdrop: string;
};

export default function EditableAvatar({ size, backdrop }: Props) {
  const { session, profile, refreshProfile } = useAuth();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const run = async (action: 'upload' | 'remove') => {
    if (!session?.user.id) return;
    setBusy(true);
    const res =
      action === 'upload'
        ? await pickAndUploadAvatar(session.user.id)
        : await removeAvatar(session.user.id);
    setBusy(false);
    if (res.error) {
      Alert.alert('Profile photo', res.error);
    } else if (action === 'remove' || ('url' in res && res.url)) {
      hapticSuccess();
      await refreshProfile();
    }
  };

  const onPress = () => {
    if (busy || !session?.user.id) return;
    hapticLight();
    if (profile?.avatar_url) setMenuOpen(true);
    else run('upload');
  };

  const badge = Math.round(size * 0.34);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change profile photo"
        onPress={onPress}
        style={({ pressed }) => [pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] }]}
      >
        <Avatar
          userId={profile?.id}
          name={profile?.display_name}
          username={profile?.username}
          avatarUrl={profile?.avatar_url}
          size={size}
        />
        {busy ? (
          <View style={[styles.overlay, { borderRadius: size / 2 }]}>
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        ) : (
          <View
            style={[
              styles.badge,
              {
                width: badge,
                height: badge,
                borderRadius: badge / 2,
                backgroundColor: colors.accent,
                borderColor: backdrop,
              },
            ]}
          >
            <CameraIcon size={Math.round(badge * 0.55)} color="#FFFFFF" />
          </View>
        )}
      </Pressable>
      <ActionMenuSheet
        visible={menuOpen}
        title="Profile photo"
        options={[
          { label: 'Choose photo', onPress: () => run('upload') },
          { label: 'Remove photo', onPress: () => run('remove'), destructive: true },
        ]}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
