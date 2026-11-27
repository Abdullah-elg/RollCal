// Design foundation for RollCal.
// Film-camera feel: paper, warm film ink for main buttons, and one coral
// for links, switches and anything live (like the photo strip's labels). Components get the active palette via
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
  // Warm highlight for what's new or happening now (Live now, new-photo
  // rings, "+12 new"). Never for buttons; green stays the action colour.
  live: string;
  onLive: string;
  scrim: string;
  glassBg: string;
};

export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    paper: '#F6F4EE',
    card: '#FFFEFA',
    line: '#D6D1C3',
    ink: '#161A17',
    inkMuted: '#636A62',
    accent: '#2A2420',
    onAccent: '#FFFFFF',
    accentText: '#B8452A',
    danger: '#A3282B',
    onDanger: '#FFFFFF',
    live: '#B8452A',
    onLive: '#FFFFFF',
    scrim: 'rgba(22, 26, 23, 0.45)',
    glassBg: 'rgba(246, 244, 238, 0.95)',
  },
  dark: {
    paper: '#111513',
    card: '#1E2420',
    line: '#2A312D',
    ink: '#EEF0EA',
    inkMuted: '#9AA39B',
    accent: '#EFE9DD',
    onAccent: '#111513',
    accentText: '#F0997B',
    danger: '#E5534B',
    // Dark text on the red (5.0:1); white was 3.7:1.
    onDanger: '#111513',
    live: '#F0997B',
    onLive: '#111513',
    scrim: 'rgba(0, 0, 0, 0.7)',
    glassBg: 'rgba(17, 21, 19, 0.95)',
  },
};

// Fixed switch colors
export const switchTint = '#FFFFFF';
export const switchTrackTint = '#B8452A';
export const switchThumbOff = '#FFFEFA';
// Off track at 3.2:1 against cards, so an off switch is visible.
export const switchTrackOff = '#959083';

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
// Corner rounding, one size per role so every curve is intentional:
//   tag     4   tiny labels on top of things (EXP counter, "Cover", badges)
//   control 10  anything you tap or type in: buttons, fields, toggles, chips
//   card    16  cards, tiles, photo thumbnails, dialogs
//   sheet   24  the top corners of sheets that slide or fade up
//   full        avatars, pills, round icon buttons
// Inside a rounded box, use (outer radius - padding) so curves stay parallel.
// sm / md / lg are older names kept while screens move over; prefer the roles.
export const radii = {
  tag: 4,
  control: 10,
  card: 16,
  sheet: 24,
  full: 999,
  sm: 4,
  md: 8,
  lg: 12,
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
