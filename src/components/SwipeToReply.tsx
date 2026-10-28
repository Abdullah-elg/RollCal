// Drag a chat message to the right to reply to it, as in most messaging
// apps. A reply arrow fades in behind it; past the line there's a tap of
// haptics, and letting go starts the reply. Only clearly sideways drags
// count, so scrolling the chat is untouched, and drags starting at the very
// edge are left to the system's back swipe.

import { ReactNode, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { hapticLight } from '../lib/haptics';
import { ArrowIcon } from './icons';

const TRIGGER = 56;
const MAX = 72;
const EDGE = 24;

type Props = {
  children: ReactNode;
  onReply: () => void;
  disabled?: boolean;
};

export default function SwipeToReply({ children, onReply, disabled }: Props) {
  const { colors } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const passed = useRef(false);
  const replyRef = useRef(onReply);
  replyRef.current = onReply;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (e, g) =>
          !disabled &&
          g.dx > 12 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 2 &&
          e.nativeEvent.pageX - g.dx > EDGE,
        onPanResponderMove: (_, g) => {
          const dx = Math.max(0, Math.min(MAX, g.dx));
          x.setValue(dx);
          if (dx >= TRIGGER && !passed.current) {
            passed.current = true;
            hapticLight();
          } else if (dx < TRIGGER) {
            passed.current = false;
          }
        },
        onPanResponderRelease: () => {
          if (passed.current) replyRef.current();
          passed.current = false;
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        },
        onPanResponderTerminate: () => {
          passed.current = false;
          Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [disabled, x]
  );

  const arrowOpacity = x.interpolate({ inputRange: [0, TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <View>
      <Animated.View style={[styles.arrow, { opacity: arrowOpacity }]} pointerEvents="none">
        <View style={[styles.arrowCircle, { backgroundColor: colors.card, borderColor: colors.line }]}>
          {/* Points back, toward the message being answered. */}
          <ArrowIcon size={14} color={colors.inkMuted} direction="left" />
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  arrowCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
