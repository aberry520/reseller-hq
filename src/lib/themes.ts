// App color themes. Every screen builds its styles from the active
// theme's palette (see theme-context), so switching themes in Settings
// recolors the whole app at once. `field` is the background of text
// inputs — white on light themes, a raised dark tone on dark themes.

export interface ThemeColors {
  primary: string;
  text: string;
  muted: string;
  background: string;
  card: string;
  field: string;
  border: string;
  divider: string;
  chip: string;
  danger: string;
  success: string;
}

export interface Theme {
  label: string;
  dark: boolean;
  colors: ThemeColors;
}

export const THEMES = {
  classic: {
    label: 'Classic Blue',
    dark: false,
    colors: {
      primary: '#0969da',
      text: '#1f2328',
      muted: '#656d76',
      background: '#ffffff',
      card: '#f6f8fa',
      field: '#ffffff',
      border: '#d0d7de',
      divider: '#eaeef2',
      chip: '#eaeef2',
      danger: '#cf222e',
      success: '#1a7f37',
    },
  },
  forest: {
    label: 'Forest',
    dark: false,
    colors: {
      primary: '#1a7f37',
      text: '#1c2a1e',
      muted: '#5f7263',
      background: '#f7faf7',
      card: '#edf3ed',
      field: '#ffffff',
      border: '#cfddd0',
      divider: '#e2ece3',
      chip: '#e2ece3',
      danger: '#cf222e',
      success: '#1a7f37',
    },
  },
  sunset: {
    label: 'Sunset',
    dark: false,
    colors: {
      primary: '#e8590c',
      text: '#2d1a12',
      muted: '#8a6a58',
      background: '#fffaf5',
      card: '#fdf0e4',
      field: '#ffffff',
      border: '#ecd9c8',
      divider: '#f5e6da',
      chip: '#f5e6da',
      danger: '#cf222e',
      success: '#1a7f37',
    },
  },
  grape: {
    label: 'Grape',
    dark: false,
    colors: {
      primary: '#8250df',
      text: '#241d33',
      muted: '#6f6585',
      background: '#fbf9ff',
      card: '#f2edfd',
      field: '#ffffff',
      border: '#ddd3f5',
      divider: '#eae4fa',
      chip: '#eae4fa',
      danger: '#cf222e',
      success: '#1a7f37',
    },
  },
  midnight: {
    label: 'Midnight',
    dark: true,
    colors: {
      primary: '#2f81f7',
      text: '#e6edf3',
      muted: '#8b949e',
      background: '#0d1117',
      card: '#161b22',
      field: '#21262d',
      border: '#30363d',
      divider: '#21262d',
      chip: '#21262d',
      danger: '#f85149',
      success: '#3fb950',
    },
  },
  slate: {
    label: 'Slate Dark',
    dark: true,
    colors: {
      primary: '#8ab4f8',
      text: '#e8eaed',
      muted: '#9aa0a6',
      background: '#111418',
      card: '#1a1e24',
      field: '#22262c',
      border: '#2f353c',
      divider: '#23282e',
      chip: '#23282e',
      danger: '#f28b82',
      success: '#81c995',
    },
  },
} as const satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

export const THEME_ORDER: ThemeName[] = [
  'classic',
  'forest',
  'sunset',
  'grape',
  'midnight',
  'slate',
];

export const DEFAULT_THEME: ThemeName = 'classic';

export function isThemeName(value: string): value is ThemeName {
  return Object.prototype.hasOwnProperty.call(THEMES, value);
}
