import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { ArrowIcon, CalendarIcon, CameraIcon, CloseIcon, PlusIcon, TicketIcon } from './icons';
import { hapticLight, hapticSuccess } from '../lib/haptics';
import { getOpenUploadEvents, pickAndUploadPhotos } from '../lib/photos';
import { fonts, Palette, radii, spacing, TypeTokens } from '../theme';
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
  const { session } = useAuth();
  const userId = session?.user.id;
  const { colors, type, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors, type), [colors, type]);

  const [openEvents, setOpenEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
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
        setLoadingEvents(true);
        getOpenUploadEvents(userId).then((list) => {
          setOpenEvents(list);
          setLoadingEvents(false);
        });
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
    const { count, error } = await pickAndUploadPhotos(event.id, userId);
    setUploading(false);
    if (count > 0) {
      hapticSuccess();
      onClose();
      onPhotosUploaded?.(event.id, count);
    } else if (!error) {
      // User cancelled picker
    }
  };

  const handleAddPhotosPress = () => {
    hapticLight();
    if (openEvents.length === 1) {
      handleStartPhotoUpload(openEvents[0]);
    } else if (openEvents.length > 1) {
      setViewMode('photos');
    }
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
          {/* Handle bar */}
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
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
              {/* Option 1: New event */}
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

              {/* Option 2: Join an event */}
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

              {/* Option 3: Add photos (Only shown if uploads are open for at least one event) */}
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
      gap: spacing.sm,
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
      paddingHorizontal: spacing.md,
      backgroundColor: c.paper,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      gap: spacing.md,
    },
    optionRowPressed: {
      opacity: 0.7,
      transform: [{ scale: 0.99 }],
    },
    optionIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
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
