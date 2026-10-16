// Design foundation for SociaLink.
// Film-camera feel: paper, ink and a deep film green. Components get the active palette via
// useTheme() from src/context/ThemeContext - never import a palette directly
// into a component, or dark mode won't reach it.

export type Palette = {
  paper: string;
  card: string;
  ink: string;
  inkMuted: string;
  line: string;
  accent: string;
  onAccent: string;
  accentText: string;
  danger: string;
  onDanger: string;
  scrim: string;
  glassBg: string;
};

export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    paper: '#F6F4EE',
    card: '#FFFEFA',
    line: '#E2DFD5',
    ink: '#161A17',
    inkMuted: '#636A62',
    accent: '#1F5C4A',
    onAccent: '#FFFFFF',
    accentText: '#1F5C4A',
    danger: '#A3282B',
    onDanger: '#FFFFFF',
    scrim: 'rgba(22, 26, 23, 0.45)',
    glassBg: 'rgba(246, 244, 238, 0.95)',
  },
  dark: {
    paper: '#111513',
    card: '#1A1F1C',
    line: '#2A312D',
    ink: '#EEF0EA',
    inkMuted: '#9AA39B',
    accent: '#5FA88A',
    onAccent: '#0B1310',
    accentText: '#7CC0A2',
    danger: '#E5534B',
    onDanger: '#FFFFFF',
    scrim: 'rgba(0, 0, 0, 0.7)',
    glassBg: 'rgba(17, 21, 19, 0.95)',
  },
};

// Fixed switch colors
export const switchTint = '#1F5C4A';
export const switchTrackTint = '#BCD5C9';
export const switchThumbOff = '#FFFEFA';
export const switchTrackOff = '#E2DFD5';

// Bottom tab bar height, excluding the safe-area inset.
export const tabBarHeight = 52;

export const fonts = {
  // Display - page and event titles
  display: 'Figtree_700Bold',
  // Headings and body - Figtree, a soft, rounded sans that stays crisp small
  heading: 'Figtree_700Bold',
  headingMedium: 'Figtree_600SemiBold',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemiBold: 'Figtree_600SemiBold',
} as const;

// 4pt-based spacing scale. Pick from these, don't invent one-off values.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

// Sharp-ish corners.
export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  full: 999,
} as const;

// Text styles are built from the active palette so they follow the theme.
export function makeType(c: Palette) {
  return {
    display: { fontFamily: fonts.display, fontSize: 30, color: c.ink, letterSpacing: -0.5 },
    title: { fontFamily: fonts.display, fontSize: 28, color: c.ink, letterSpacing: -0.5 },
    h2: { fontFamily: fonts.heading, fontSize: 22, color: c.ink, letterSpacing: -0.3 },
    h3: { fontFamily: fonts.headingMedium, fontSize: 17, color: c.ink },
    body: { fontFamily: fonts.body, fontSize: 15, color: c.ink, lineHeight: 22 },
    bodyMuted: { fontFamily: fonts.body, fontSize: 15, color: c.inkMuted, lineHeight: 22 },
    caption: { fontFamily: fonts.body, fontSize: 13, color: c.inkMuted },
    button: { fontFamily: fonts.bodySemiBold, fontSize: 15 },
    sectionLabel: { fontFamily: fonts.body, fontSize: 15, color: c.inkMuted },
  } as const;
}

export type TypeTokens = ReturnType<typeof makeType>;
