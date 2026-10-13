import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export function hapticLight() {
  if (Platform.OS === 'web') return;
  try {
    if (typeof Haptics?.impactAsync === 'function') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  } catch {
    // Ignore environments where native haptics are not linked or available
  }
}

export function hapticMedium() {
  if (Platform.OS === 'web') return;
  try {
    if (typeof Haptics?.impactAsync === 'function') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  } catch {
    // Ignore
  }
}

// Vintage mechanical camera shutter release: two crisp successive clicks
export function hapticShutter() {
  if (Platform.OS === 'web') return;
  try {
    if (typeof Haptics?.impactAsync === 'function') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }, 70);
    }
  } catch {
    // Ignore
  }
}

export function hapticSuccess() {
  if (Platform.OS === 'web') return;
  try {
    if (typeof Haptics?.notificationAsync === 'function') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  } catch {
    // Ignore
  }
}

export function hapticError() {
  if (Platform.OS === 'web') return;
  try {
    if (typeof Haptics?.notificationAsync === 'function') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  } catch {
    // Ignore
  }
}
