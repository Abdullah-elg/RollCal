import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { makeType, Palette, palettes, TypeTokens } from '../theme';

const STORAGE_KEY = 'socialink.themePreference';
const OLD_STORAGE_KEY = 'socialink.themeMode';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  preference: ThemePreference;
  colors: Palette;
  type: TypeTokens;
  setPreference: (pref: ThemePreference) => void;
  setMode: (pref: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  // Hold rendering until the stored choice loads, so a user never sees a flash on launch.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'system' || stored === 'dark' || stored === 'light') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const mode: ThemeMode = useMemo(() => {
    if (preference === 'system') {
      return systemColorScheme === 'dark' ? 'dark' : 'light';
    }
    return preference;
  }, [preference, systemColorScheme]);

  const value = useMemo<ThemeContextValue>(() => {
    const colors = palettes[mode];
    return {
      mode,
      preference,
      colors,
      type: makeType(colors),
      setPreference,
      setMode: setPreference,
    };
  }, [mode, preference]);

  if (!ready) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
