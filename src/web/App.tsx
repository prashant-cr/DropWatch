import { useCallback, useEffect, useState } from 'react';
import type { SettingsResponse } from '@shared/types';
import { api } from './api';
import { useTheme } from './hooks/useTheme';
import { Link, matchWatchId, useRouter } from './router';
import { Dashboard } from './pages/Dashboard';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { WatchDetail } from './pages/WatchDetail';
import {
  HistoryIcon,
  LogoIcon,
  MoonIcon,
  PackageIcon,
  SettingsIcon,
  SunIcon,
} from './components/icons';

export function App() {
  const { path } = useRouter();
  const { theme, setTheme, isDark } = useTheme();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((result) => setSettings(result.settings))
      .catch(() => setSettings(null));
  }, []);

  const dismissOnboarding = useCallback(() => {
    setSettings((current) => (current ? { ...current, onboarding_dismissed: true } : current));
    void api.saveSettings({ onboarding_dismissed: true }).catch(() => undefined);
  }, []);

  const watchId = matchWatchId(path);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-50/85 backdrop-blur dark:border-white/10 dark:bg-[#0b0d10]/85">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <LogoIcon className="h-7 w-7" />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
              DropWatch
            </span>
          </Link>

          <nav className="ml-2 flex items-center gap-0.5">
            <NavLink
              to="/"
              active={watchId !== null || path === '/'}
              icon={<PackageIcon className="h-4 w-4" />}
            >
              Watches
            </NavLink>
            <NavLink
              to="/history"
              active={path === '/history'}
              icon={<HistoryIcon className="h-4 w-4" />}
            >
              History
            </NavLink>
            <NavLink
              to="/settings"
              active={path === '/settings'}
              icon={<SettingsIcon className="h-4 w-4" />}
            >
              Settings
            </NavLink>
          </nav>

          <button
            type="button"
            className="btn-ghost ml-auto rounded-lg p-2"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode (currently ${theme})`}
            aria-label="Toggle colour theme"
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {watchId !== null ? (
          <WatchDetail id={watchId} isDark={isDark} />
        ) : path === '/settings' ? (
          <Settings settings={settings} onSaved={setSettings} />
        ) : path === '/history' ? (
          <History currency={settings?.currency ?? 'USD'} />
        ) : path === '/' ? (
          <Dashboard settings={settings} onDismissOnboarding={dismissOnboarding} />
        ) : (
          <NotFound />
        )}
      </main>

      <footer className="border-t border-slate-200/70 py-5 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-4 text-xs text-slate-400 sm:px-6 dark:text-slate-500">
          DropWatch · self-hosted, MIT licensed. Checks are rate-limited and never attempt to bypass
          a site’s access controls.
        </div>
      </footer>
    </div>
  );
}

function NavLink({
  to,
  active,
  icon,
  children,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-slate-900/[0.06] text-slate-900 dark:bg-white/10 dark:text-white'
          : 'text-slate-500 hover:bg-slate-900/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}

function NotFound() {
  return (
    <div className="card p-12 text-center">
      <h1 className="text-base font-semibold text-slate-900 dark:text-white">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        That address does not match anything in DropWatch.
      </p>
      <Link to="/" className="btn-secondary mt-5 inline-flex">
        Back to dashboard
      </Link>
    </div>
  );
}
