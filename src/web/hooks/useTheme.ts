import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'pricewatch-theme';

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** System default, with an explicit override the user can toggle in the header. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void; isDark: boolean } {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    apply(theme);
    setIsDark(document.documentElement.classList.contains('dark'));

    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      apply('system');
      setIsDark(media.matches);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing — the choice just will not persist.
    }
    setThemeState(next);
  }, []);

  return { theme, setTheme, isDark };
}
