import { useEffect, useRef } from 'react';
import { Animated, Easing, Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// iOS reports ~250ms for its keyboard; leading it slightly feels immediate.
const SHIFT_DURATION = 170;

// How far to lift a screen so the keyboard doesn't cover its bottom bar.
//
// React Native's KeyboardAvoidingView animates a padding change, which means
// re-laying out everything above it - on a long list that lands visibly late.
// This follows the keyboard's own notification instead, matching its duration
// exactly, and moves the view with a transform on the native driver, so
// nothing is re-laid out at all.
//
// iOS only. On Android the window's own keyboard handling already moves
// things, so screens there use KeyboardAvoidingView instead - shifting as
// well would lift the content twice as far as the keyboard.
export function useKeyboardShift(): Animated.Value {
  const insets = useSafeAreaInsets();
  const shift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const onShow = Keyboard.addListener('keyboardWillShow', (e) => {
      Animated.timing(shift, {
        // The safe-area padding at the bottom is already accounted for.
        toValue: Math.max(0, e.endCoordinates.height - insets.bottom),
        // Deliberately quicker than the keyboard's own duration, and
        // front-loaded: the composer should arrive as the keyboard sweeps up
        // rather than trailing behind it, which reads as lag.
        duration: SHIFT_DURATION,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
    const onHide = Keyboard.addListener('keyboardWillHide', (e) => {
      Animated.timing(shift, {
        toValue: 0,
        duration: SHIFT_DURATION,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [shift, insets.bottom]);

  return shift;
}
