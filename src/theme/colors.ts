/**
 * Design tokens inspired by the hardware RSVP Nano LCD aesthetic.
 * The original device uses a 640×172 AMOLED with dark/light/night themes.
 */

export const Colors = {
  // ── Dark theme (default, matches hardware dark mode) ──
  dark: {
    background: '#0a0a0f',
    surface: '#14141e',
    surfaceElevated: '#1c1c2a',
    textPrimary: '#e8e6e1',
    textSecondary: '#75706a',
    textDim: '#3d3a36',
    accent: '#d3542f',
    accentDeep: '#842f20',
    focusRed: '#e63b2e',
    guideColor: 'rgba(230, 59, 46, 0.35)',
    border: '#2a2838',
    progressTrack: '#1e1c28',
    progressFill: '#d3542f',
    phantomText: 'rgba(80, 80, 90, 0.5)',
    cardGlow: 'rgba(211, 84, 47, 0.06)',
  },

  // ── Light theme ──
  light: {
    background: '#f7efe2',
    surface: '#fffaf1',
    surfaceElevated: '#ffffff',
    textPrimary: '#1d1711',
    textSecondary: '#75695c',
    textDim: '#c5baa8',
    accent: '#d3542f',
    accentDeep: '#842f20',
    focusRed: '#d3542f',
    guideColor: 'rgba(211, 84, 47, 0.3)',
    border: '#decdb7',
    progressTrack: '#ede4d5',
    progressFill: '#d3542f',
    phantomText: 'rgba(120, 110, 100, 0.4)',
    cardGlow: 'rgba(211, 84, 47, 0.08)',
  },

  // ── Night theme (red-shifted for low light) ──
  night: {
    background: '#0f0505',
    surface: '#1a0a0a',
    surfaceElevated: '#240e0e',
    textPrimary: '#cc8877',
    textSecondary: '#7a4a3e',
    textDim: '#3a1f18',
    accent: '#993322',
    accentDeep: '#661a11',
    focusRed: '#cc4433',
    guideColor: 'rgba(204, 68, 51, 0.35)',
    border: '#2e1510',
    progressTrack: '#1e0d0a',
    progressFill: '#993322',
    phantomText: 'rgba(70, 40, 35, 0.5)',
    cardGlow: 'rgba(153, 51, 34, 0.06)',
  },
} as const;

export type ThemeName = keyof typeof Colors;
export type ThemeColors = (typeof Colors)[ThemeName];
