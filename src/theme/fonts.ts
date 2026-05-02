/**
 * Font family mapping. Mirrors the three typefaces from DisplayManager:
 * Standard (system serif), AtkinsonHyperlegible, and OpenDyslexic.
 *
 * Custom fonts are loaded via expo-font useFonts hook.
 * If custom fonts fail, we gracefully fall back to system serif.
 */

export type TypefaceName = 'standard' | 'atkinson' | 'opendyslexic';

export const FontFamilies: Record<TypefaceName, { regular: string; bold: string }> = {
  standard: {
    regular: 'System', // Falls back to platform serif
    bold: 'System',
  },
  atkinson: {
    regular: 'AtkinsonHyperlegible-Regular',
    bold: 'AtkinsonHyperlegible-Bold',
  },
  opendyslexic: {
    regular: 'OpenDyslexic-Regular',
    bold: 'OpenDyslexic-Bold',
  },
};

/** Font sizes matching the hardware's Large / Medium / Small levels */
export const FontSizes = {
  large: 48,
  medium: 38,
  small: 30,
} as const;

export type FontSizeLevel = keyof typeof FontSizes;

/** Custom font asset map for useFonts hook */
export const CustomFontAssets = {
  'AtkinsonHyperlegible-Regular': require('../../assets/fonts/AtkinsonHyperlegible-Regular.ttf'),
  'AtkinsonHyperlegible-Bold': require('../../assets/fonts/AtkinsonHyperlegible-Bold.ttf'),
  'OpenDyslexic-Regular': require('../../assets/fonts/OpenDyslexic-Regular.otf'),
  'OpenDyslexic-Bold': require('../../assets/fonts/OpenDyslexic-Bold.otf'),
};
