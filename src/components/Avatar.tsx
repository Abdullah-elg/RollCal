import { useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { hapticLight } from '../lib/haptics';
import { fonts } from '../theme';

// Curated palette of muted, earthy tones that pair naturally with the paper and darkroom surfaces
const LIGHT_BG = [
  '#E5DFD4', // warm driftwood
  '#DFE4DA', // dusty sage
  '#DFDEE7', // slate chalk
  '#E7DDD8', // clay blush
  '#E3E1D4', // warm oat
  '#D7E1DF', // muted teal
  '#E2DADF', // heather
  '#DDDCD8', // ash pebble
];

const DARK_BG = [
  '#2C261F', // deep driftwood
  '#232A22', // deep sage
  '#242630', // deep slate
  '#302321', // deep clay
  '#2C291E', // deep oat
  '#1E2A29', // deep teal
  '#2C212B', // deep heather
  '#252525', // deep ash
];

function getAvatarBgColor(userId: string | undefined | null, mode: 'light' | 'dark'): string {
  if (!userId) return mode === 'dark' ? '#2A241E' : '#E5DFD4';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % LIGHT_BG.length;
  return mode === 'dark' ? DARK_BG[idx] : LIGHT_BG[idx];
}

function getInitials(name: string | undefined | null): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type AvatarProps = {
  userId?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  onPress?: () => void;
};

export default function Avatar({
  userId,
  name,
  avatarUrl,
  size = 32,
  style,
  textStyle,
  onPress,
}: AvatarProps) {
  const { colors, mode } = useTheme();
  const bgColor = getAvatarBgColor(userId, mode);
  const initials = getInitials(name);
  const fontSize = Math.round(size * 0.4);

  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.94,
      friction: 9,
      tension: 120,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 9,
      tension: 120,
      useNativeDriver: true,
    }).start();
  };

  const circle = (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bgColor,
        },
        style,
      ]}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text
          numberOfLines={1}
          style={[
            styles.text,
            {
              fontSize,
              color: colors.ink,
            },
            textStyle,
          ]}
        >
          {initials}
        </Text>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={() => {
            hapticLight();
            onPress();
          }}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          {circle}
        </Pressable>
      </Animated.View>
    );
  }

  return circle;
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: {
    fontFamily: fonts.bodySemiBold,
    letterSpacing: -0.2,
  },
});
