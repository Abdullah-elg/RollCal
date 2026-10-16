import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Haptics are a nice-to-have, so failures are swallowed rather than surfaced.
const ignore = () => {};
const enabled = Platform.OS !== 'web';

export function hapticLight() {
  if (enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore);
}

export function hapticMedium() {
  if (enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(ignore);
}

// Two quick clicks, like a mechanical camera shutter.
export function hapticShutter() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore);
  setTimeout(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(ignore);
  }, 70);
}

export function hapticSuccess() {
  if (enabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
}
