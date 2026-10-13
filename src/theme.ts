// Design foundation for SociaLink.
// Warm, analog, photo-album feel. Components get the active palette via
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
    paper: '#FAF6EF',
    card: '#FFFDF9',
    line: '#E6DFD3',
    ink: '#1A1712',
    inkMuted: '#6E675D',
    accent: '#C8553D',
    onAccent: '#FFFFFF',
    accentText: '#B04A34',
    danger: '#9B2226',
    onDanger: '#FFFFFF',
    scrim: 'rgba(26, 23, 18, 0.45)',
    glassBg: 'rgba(250, 246, 239, 0.95)',
  },
  dark: {
    paper: '#17140F',
    card: '#221E18',
    line: '#332D25',
    ink: '#F3EEE6',
    inkMuted: '#A69E92',
    accent: '#D9694F',
    onAccent: '#1A0D08',
    accentText: '#E07A5F',
    danger: '#E5534B',
    onDanger: '#FFFFFF',
    scrim: 'rgba(0, 0, 0, 0.7)',
    glassBg: 'rgba(23, 20, 15, 0.95)',
  },
};

// Fixed switch colors
export const switchTint = '#C8553D';
export const switchTrackTint = '#F3C7BE';
export const switchThumbOff = '#FFFDF9';
export const switchTrackOff = '#E6DFD3';

// Flat bottom tab bar metrics
export const tabBarHeight = 52;
export const floatingTabBar = {
  height: 52,
  sideInset: 0,
  bottomGap: 0,
} as const;

export const fonts = {
  // Display - Instrument Serif for big display moments
  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',
  // Headings - Bricolage Grotesque
  heading: 'BricolageGrotesque_700Bold',
  headingMedium: 'BricolageGrotesque_600SemiBold',
  // Body - Public Sans
  body: 'PublicSans_400Regular',
  bodyMedium: 'PublicSans_500Medium',
  bodySemiBold: 'PublicSans_600SemiBold',
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
    display: { fontFamily: fonts.display, fontSize: 36, color: c.ink },
    title: { fontFamily: fonts.display, fontSize: 32, color: c.ink },
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
