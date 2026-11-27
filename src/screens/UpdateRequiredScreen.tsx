import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { STORE_URLS } from '../lib/minVersion';
import { spacing } from '../theme';

// Shown instead of the app when this build is older than app_config's
// min_version (see lib/minVersion.ts). Nothing else is reachable from here.
export default function UpdateRequiredScreen() {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const url = Platform.OS === 'ios' ? STORE_URLS.ios : STORE_URLS.android;
  const store = Platform.OS === 'ios' ? 'the App Store' : 'Google Play';

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.paper,
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.lg,
        },
      ]}
    >
      <View style={styles.body}>
        <Text style={type.display} accessibilityRole="header">
          Update RollCal
        </Text>
        <Text style={[type.bodyMuted, { marginTop: spacing.sm }]}>
          This version of RollCal is no longer supported. Get the latest one from {store} to keep
          going. Your events, photos and bills are all still there.
        </Text>
      </View>
      <Button title="Update" onPress={() => Linking.openURL(url).catch(() => {})} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.lg },
  body: { flex: 1, justifyContent: 'center' },
});
