// Theme plumbing: a React context holding the active theme, backed by
// the saved setting so the choice survives restarts. Screens build
// their styles with useThemedStyles(createStyles), where createStyles
// is a module-level (colors) => StyleSheet.create(...) factory — the
// styles are recomputed whenever the theme changes, so a switch in
// Settings recolors the whole app live, no restart or remount needed.

import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getSettings, saveSettings } from './db';
import { DEFAULT_THEME, isThemeName, THEMES } from './themes';
import type { ThemeColors, ThemeName } from './themes';

interface ThemeContextValue {
  themeName: ThemeName;
  colors: ThemeColors;
  dark: boolean;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeName: DEFAULT_THEME,
  colors: THEMES[DEFAULT_THEME].colors,
  dark: THEMES[DEFAULT_THEME].dark,
  setTheme: () => undefined,
});

function savedTheme(): ThemeName {
  try {
    const t = getSettings().theme;
    return isThemeName(t) ? t : DEFAULT_THEME;
  } catch {
    // The settings table may not exist yet on the very first launch
    // (initDb runs in an effect after first render) — the default
    // theme is the right answer then anyway.
    return DEFAULT_THEME;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(savedTheme);

  const setTheme = (name: ThemeName) => {
    setThemeName(name);
    saveSettings({ ...getSettings(), theme: name });
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeName,
      colors: THEMES[themeName].colors,
      dark: THEMES[themeName].dark,
      setTheme,
    }),
    [themeName],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

// Build a component's styles from the active theme. The factory must
// be a stable module-level function so the memo only recomputes when
// the theme actually changes.
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors, factory]);
}
