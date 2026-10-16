import { LayoutAnimation, Platform } from 'react-native';

// Call right before a setState that *replaces* content already on screen  - 
// a pull-to-refresh, a list changing after an action - so the swap eases
// instead of snapping.
//
// Deliberately not called for a screen's first paint: LayoutAnimation also
// animates views as they're added, which on a freshly mounted screen makes
// the whole page appear to slide in from the edge. Callers pass the flag
// they already use to know whether they've loaded once.
export function animateNext(hasContent = true) {
  // iOS applies a layout animation to the whole next layout pass, not just
  // the view that asked for it - a list refresh here would animate the tab
  // bar's icons and any screen that happens to be mounting, which reads as
  // lag and stray sliding. Android scopes it sanely, so it keeps the polish.
  if (Platform.OS === 'ios') return;
  if (!hasContent) return;
  // Short and ease-out: long enough to soften a data swap, short enough
  // that the app never feels like it's lagging behind the tap.
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      150,
      LayoutAnimation.Types.easeOut,
      LayoutAnimation.Properties.opacity
    )
  );
}
