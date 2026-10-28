import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { UnreadProvider } from './src/context/UnreadContext';
import { startCrashReporting, wrapRoot } from './src/lib/crashReporting';
import RootNavigator from './src/navigation/RootNavigator';

// Keep the splash up until fonts load and the saved session is restored, so
// nothing flashes in a fallback font and the login screen never blinks past.
// RootNavigator hides it once auth has settled.
startCrashReporting();
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 300 });

function App() {
  const [fontsLoaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <UnreadProvider>
            <RootNavigator />
          </UnreadProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default wrapRoot(App);
