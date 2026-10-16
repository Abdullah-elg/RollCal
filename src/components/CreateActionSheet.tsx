import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ArrowIcon, CalendarIcon, CameraIcon, CloseIcon, TicketIcon } from './icons';
import { hapticLight } from '../lib/haptics';
import { getOpenUploadEvents, pickAndUploadPhotos } from '../lib/photos';
import { fonts, Palette, spacing, TypeTokens } from '../theme';
import { Event } from '../types';

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigateNewEvent: () => void;
  onNavigateJoinEvent: () => void;
  onPhotosUploaded?: (eventId: string, count: number) => void;
};

export default function CreateActionSheet({
  visible,
  onClose,
  onNavigateNewEvent,
  onNavigateJoinEvent,
  onPhotosUploaded,
}: Props) {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors, type), [colors, type]);

  const [openEvents, setOpenEvents] = useState<Event[]>([]);
  const [viewMode, setViewMode] = useState<'main' | 'photos'>('main');
  const [uploading, setUploading] = useState(false);

  const anim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setViewMode('main');
      Animated.spring(anim, {
        toValue: 1,
        tension: 100,
        friction: 12,
        useNativeDriver: true,
      }).start();

      if (userId) {
        getOpenUploadEvents(userId).then(setOpenEvents);
      }
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, userId, anim]);

  const handleClose = () => {
    hapticLight();
    onClose();
  };

  const handleNewEvent = () => {
    onClose();
    onNavigateNewEvent();
  };

  const handleStartPhotoUpload = async (event: Event) => {
    if (!userId) return;
    setUploading(true);
    const { count, error } = await pickAndUploadPhotos(event.id, userId, !!profile?.is_pro);
    setUploading(false);
    // pickAndUploadPhotos already plays the shutter haptic on success.
    if (count > 0) {
      onClose();
      onPhotosUploaded?.(event.id, count);
    }
    if (error) {
      Alert.alert(
        count > 0 ? `Uploaded ${count}, then one failed` : 'Upload failed',
        error
      );
    }
  };

  // Always pick the event first, even with only one open roll, so it's clear
  // where the photos are going.
  const handleAddPhotosPress = () => {
    hapticLight();
    if (openEvents.length > 0) setViewMode('photos');
  };

  if (!visible) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  const backdropOpacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16) + spacing.md,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            {viewMode === 'photos' ? (
              <Pressable
                onPress={() => setViewMode('main')}
                style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
                hitSlop={8}
              >
                <ArrowIcon size={18} color={colors.ink} direction="left" />
                <Text style={styles.headerTitle}>Choose event</Text>
              </Pressable>
            ) : (
              <Text style={styles.headerTitle}>Start something</Text>
            )}

            <Pressable
              onPress={handleClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            >
              <CloseIcon size={18} color={colors.inkMuted} />
            </Pressable>
          </View>

          {uploading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Uploading shots to the roll…</Text>
            </View>
          ) : viewMode === 'photos' ? (
            /* Multi-event picker view */
            <View style={styles.optionsList}>
              <Text style={styles.subHint}>
                Which event's roll are you adding photos to?
              </Text>
              {openEvents.map((evt) => (
                <Pressable
                  key={evt.id}
                  onPress={() => handleStartPhotoUpload(evt)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    pressed && styles.optionRowPressed,
                  ]}
                >
                  <View style={styles.optionIconWrap}>
                    <CameraIcon size={20} color={colors.accent} />
                  </View>
                  <View style={styles.optionContent}>
                    <Text style={styles.optionLabel}>{evt.title}</Text>
                    <Text style={styles.optionCaption}>The roll is currently open</Text>
                  </View>
                  <ArrowIcon size={16} color={colors.inkMuted} direction="right" />
                </Pressable>
              ))}
            </View>
          ) : (
            /* Main options */
            <View style={styles.optionsList}>
              <Pressable
                onPress={handleNewEvent}
                style={({ pressed }) => [
                  styles.optionRow,
                  pressed && styles.optionRowPressed,
                ]}
              >
                <View style={styles.optionIconWrap}>
                  <CalendarIcon size={20} color={colors.accent} />
                </View>
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>New event</Text>
                  <Text style={styles.optionCaption}>
                    Set a date, invite friends, and start a roll
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => {
                  hapticLight();
                  onClose();
                  onNavigateJoinEvent();
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  pressed && styles.optionRowPressed,
                ]}
              >
                <View style={styles.optionIconWrap}>
                  <TicketIcon size={20} color={colors.accent} />
                </View>
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>Join an event</Text>
                  <Text style={styles.optionCaption}>
                    Enter an invite code or scan a QR code
                  </Text>
                </View>
              </Pressable>

              {openEvents.length > 0 && (
                <Pressable
                  onPress={handleAddPhotosPress}
                  style={({ pressed }) => [
                    styles.optionRow,
                    pressed && styles.optionRowPressed,
                  ]}
                >
                  <View style={styles.optionIconWrap}>
                    <CameraIcon size={20} color={colors.accent} />
                  </View>
                  <View style={styles.optionContent}>
                    <Text style={styles.optionLabel}>Add photos</Text>
                    <Text style={styles.optionCaption}>
                      {openEvents.length === 1
                        ? `Drop shots into ${openEvents[0].title}`
                        : 'Choose an open roll to drop shots into'}
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette, t: TypeTokens) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: '#000000',
    },
    sheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: 0.1,
      shadowRadius: 10,
      elevation: 20,
    },
    handleWrap: {
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.line,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: spacing.xs,
      paddingBottom: spacing.md,
    },
    headerTitle: {
      ...t.h3,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 17,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    closeBtn: {
      padding: spacing.xs,
    },
    optionsList: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
    subHint: {
      ...t.caption,
      color: c.inkMuted,
      marginBottom: spacing.xs,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
      gap: spacing.md,
    },
    optionRowPressed: {
      opacity: 0.6,
    },
    optionIconWrap: {
      width: 28,
      alignItems: 'center',
    },
    optionContent: {
      flex: 1,
      gap: 2,
    },
    optionLabel: {
      ...t.body,
      fontFamily: fonts.bodySemiBold,
      color: c.ink,
      fontSize: 15,
    },
    optionCaption: {
      ...t.caption,
      color: c.inkMuted,
      fontSize: 12,
    },
    loadingWrap: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
    },
    loadingText: {
      ...t.caption,
      color: c.inkMuted,
    },
  });
