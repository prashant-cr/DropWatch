import { useMemo, useState } from 'react';
import type { SettingsResponse, WatchWithState } from '@shared/types';
import { api, ApiError } from '../api';
import { AddWatchModal } from '../components/AddWatchModal';
import { CardSkeleton, EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { WatchCard } from '../components/WatchCard';
import { BellIcon, PackageIcon, PlusIcon, WarningIcon, XIcon } from '../components/icons';
import { useWatches } from '../hooks/useWatches';
import { Link } from '../router';

interface DashboardProps {
  settings: SettingsResponse | null;
  onDismissOnboarding: () => void;
}

type Filter = 'all' | 'active' | 'triggered' | 'problem';

export function Dashboard({ settings, onDismissOnboarding }: DashboardProps) {
  const toast = useToast();
  const { watches, checking, loading, error, refresh, replace, setChecking } = useWatches();
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const showOnboarding =
    settings !== null && !settings.onboarding_dismissed && !settings.smtp_host.trim();

  const runCheck = async (id: number): Promise<void> => {
    setChecking(id, true);
    try {
      const result = await api.runCheck(id);
      if (result.watch) replace(result.watch);
      if (result.check.status === 'ok') {
        toast.success('Check complete.');
      } else {
        toast.error(result.check.error_message ?? 'The check failed.');
      }
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not run the check.');
    } finally {
      setChecking(id, false);
      void refresh();
    }
  };

  const togglePause = async (watch: WatchWithState): Promise<void> => {
    try {
      const { watch: updated } = await api.updateWatch(watch.id, { is_paused: !watch.is_paused });
      replace(updated);
      toast.info(updated.is_paused ? 'Watch paused.' : 'Watch resumed.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not update the watch.');
    }
  };

  const counts = useMemo(
    () => ({
      all: watches.length,
      active: watches.filter((w) => !w.is_paused).length,
      triggered: watches.filter(isTriggered).length,
      problem: watches.filter((w) => w.consecutive_failures > 0 || w.is_blocked).length,
    }),
    [watches],
  );

  const visible = useMemo(() => {
    switch (filter) {
      case 'active':
        return watches.filter((w) => !w.is_paused);
      case 'triggered':
        return watches.filter(isTriggered);
      case 'problem':
        return watches.filter((w) => w.consecutive_failures > 0 || w.is_blocked);
      default:
        return watches;
    }
  }, [watches, filter]);

  return (
    <div className="space-y-6">
      {showOnboarding && (
        <div
          className="card flex items-start gap-3 border-accent-500/30 bg-accent-50/70 p-4
            dark:bg-accent-500/[0.07]"
        >
          <BellIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              Set up email alerts
            </p>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
              PriceWatch is checking prices already. Add your SMTP details and it can tell you when
              one drops.{' '}
              <Link
                to="/settings"
                className="font-medium text-accent-700 underline-offset-2 hover:underline dark:text-accent-400"
              >
                Open Settings →
              </Link>
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost -mr-1 -mt-1 rounded-lg p-1.5"
            onClick={onDismissOnboarding}
            aria-label="Dismiss"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {loading
              ? 'Loading your watches…'
              : counts.all === 0
                ? 'Nothing watched yet.'
                : `${counts.active} active · ${counts.all} total`}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
          <PlusIcon />
          Add watch
        </button>
      </div>

      {counts.all > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'active', 'triggered', 'problem'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              disabled={counts[key] === 0 && key !== 'all'}
              className={`pill transition disabled:opacity-40 ${
                filter === key
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15'
              }`}
            >
              {FILTER_LABELS[key]}
              <span className="tabular opacity-60">{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="card flex items-start gap-3 border-red-300/60 bg-red-50 p-4 dark:bg-red-500/10">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">{error}</p>
            <button
              type="button"
              className="mt-1.5 text-xs font-medium text-red-700 hover:underline dark:text-red-300"
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : counts.all === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-6 w-6" />}
          title="Watch your first product"
          description="Paste a product URL and PriceWatch will detect the name and price, then check it on a schedule and email you when it drops."
          action={
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
              <PlusIcon />
              Add watch
            </button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-6 w-6" />}
          title="Nothing here"
          description="No watches match this filter."
          action={
            <button type="button" className="btn-secondary" onClick={() => setFilter('all')}>
              Show all
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              isChecking={checking.has(watch.id)}
              onRunCheck={(id) => void runCheck(id)}
              onTogglePause={(target) => void togglePause(target)}
            />
          ))}
        </div>
      )}

      <AddWatchModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(watch) => {
          replace(watch);
          void refresh();
        }}
        defaultIntervalCron={settings?.default_interval_cron ?? '0 * * * *'}
      />
    </div>
  );
}

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  active: 'Active',
  triggered: 'At target',
  problem: 'Needs attention',
};

function isTriggered(watch: WatchWithState): boolean {
  if (watch.last_check?.status !== 'ok') return false;
  if (watch.mode === 'availability') return watch.last_check.available === true;
  return (
    watch.target_price !== null &&
    watch.last_check.price !== null &&
    watch.last_check.price <= watch.target_price
  );
}
