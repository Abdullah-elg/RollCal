import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { MIN_AGE } from '../lib/age';
import { spacing } from '../theme';

// Shown on this phone after someone answers that they're under 13.
export default function AgeBlockedScreen() {
  const { colors, type } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: colors.paper }]}>
      <Text style={type.title}>Sorry</Text>
      <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>
        You need to be {MIN_AGE} or older to use RollCal.
      </Text>
      <Text style={[type.caption, { marginTop: spacing.xl }]}>
        Made a mistake? Email{' '}
        <Text
          style={{ color: colors.accentText }}
          onPress={() => Linking.openURL('mailto:support@rollcal.app')}
        >
          support@rollcal.app
        </Text>
        .
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: spacing.lg },
});
