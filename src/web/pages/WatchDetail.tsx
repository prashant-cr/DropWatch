import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Check, PricePoint, WatchWithState } from '@shared/types';
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  formatRelative,
  hostLabel,
} from '@shared/format';
import { describeCron } from '@shared/intervals';
import { api, ApiError } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditWatchModal } from '../components/EditWatchModal';
import { StatusPill } from '../components/StatusPill';
import { StoreIcon } from '../components/StoreIcon';
import { useToast } from '../components/Toast';
import {
  ChevronLeftIcon,
  ExternalLinkIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshIcon,
  SpinnerIcon,
  TrashIcon,
} from '../components/icons';
import { Link, useRouter } from '../router';
import { watchStatus } from '../status';

const RANGES = [30, 90] as const;

/** Rows of the check log shown inline; the History page has the rest. */
const LOG_ROWS = 25;

// Recharts is by far the heaviest dependency and only the detail page uses it, so it
// loads on demand rather than in the dashboard's bundle.
const PriceChart = lazy(() =>
  import('../components/PriceChart').then((module) => ({ default: module.PriceChart })),
);

export function WatchDetail({ id, isDark }: { id: number; isDark: boolean }) {
  const toast = useToast();
  const { navigate } = useRouter();

  const [watch, setWatch] = useState<WatchWithState | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [checking, setChecking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [watchResult, checkResult, historyResult] = await Promise.all([
        api.getWatch(id),
        api.checks(id, 100),
        api.history(id, days),
      ]);
      setWatch(watchResult.watch);
      setChecking(watchResult.checking);
      setChecks(checkResult.checks);
      setHistory(historyResult.points);
      setNotFound(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setNotFound(true);
      else toast.error(error instanceof Error ? error.message : 'Could not load this watch.');
    } finally {
      setLoading(false);
    }
  }, [id, days, toast]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const runCheck = async (): Promise<void> => {
    setChecking(true);
    try {
      const result = await api.runCheck(id);
      if (result.check.status === 'ok') toast.success('Check complete.');
      else toast.error(result.check.error_message ?? 'The check failed.');
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not run the check.');
    } finally {
      setChecking(false);
    }
  };

  const togglePause = async (): Promise<void> => {
    if (!watch) return;
    try {
      const { watch: updated } = await api.updateWatch(id, { is_paused: !watch.is_paused });
      setWatch(updated);
      toast.info(updated.is_paused ? 'Watch paused.' : 'Watch resumed.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not update the watch.');
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deleteWatch(id);
      toast.success('Watch deleted.');
      navigate('/');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the watch.');
    }
  };

  if (notFound) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">That watch no longer exists.</p>
        <Link to="/" className="btn-secondary mt-4 inline-flex">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (loading || !watch) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-4 w-32" />
        <div className="card space-y-4 p-6">
          <div className="skeleton h-5 w-2/3" />
          <div className="skeleton h-10 w-40" />
          <div className="skeleton h-64 w-full" />
        </div>
      </div>
    );
  }

  const status = watchStatus(watch, checking);
  const label = watch.label.trim() || hostLabel(watch.url);
  const price = watch.last_check?.status === 'ok' ? watch.last_check.price : null;

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 transition
          hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Dashboard
      </Link>

      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StoreIcon url={watch.url} />
              <a
                href={watch.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500
                  transition hover:text-accent-600 dark:text-slate-400 dark:hover:text-accent-400"
              >
                {hostLabel(watch.url)}
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
              <StatusPill status={status} />
            </div>

            <h1 className="mt-2.5 text-xl font-semibold leading-snug tracking-tight text-slate-900 dark:text-white">
              {label}
            </h1>

            <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <p className="tabular text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {formatMoney(price, watch.currency)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Current price</p>
              </div>
              {watch.mode === 'price' && (
                <div>
                  <p className="tabular text-lg font-medium text-slate-600 dark:text-slate-300">
                    {formatMoney(watch.target_price, watch.currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Target</p>
                </div>
              )}
              <div>
                <p className="text-lg font-medium text-slate-600 dark:text-slate-300">
                  {watch.last_check?.available === null || watch.last_check === null
                    ? '—'
                    : watch.last_check.available
                      ? 'In stock'
                      : 'Out of stock'}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Availability</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void runCheck()}
              disabled={checking}
            >
              {checking ? <SpinnerIcon /> : <RefreshIcon />}
              Check now
            </button>
            <button type="button" className="btn-secondary" onClick={() => void togglePause()}>
              {watch.is_paused ? (
                <PlayIcon className="h-3.5 w-3.5" />
              ) : (
                <PauseIcon className="h-3.5 w-3.5" />
              )}
              {watch.is_paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
              <PencilIcon />
              Edit
            </button>
            <button
              type="button"
              className="btn-ghost text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete watch"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {status.detail && (status.tone === 'bad' || status.tone === 'warn') && (
          <p
            className={`mt-5 rounded-lg px-3.5 py-2.5 text-xs leading-relaxed ${
              status.tone === 'bad'
                ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
            }`}
          >
            {status.detail}
          </p>
        )}

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-5 text-sm sm:grid-cols-4 dark:border-white/10">
          <Fact label="Schedule" value={describeCron(watch.interval_cron)} />
          <Fact
            label="Last checked"
            value={watch.last_check ? formatRelative(watch.last_check.checked_at) : 'Never'}
          />
          <Fact
            label="Next check"
            value={watch.is_paused ? 'Paused' : formatRelative(watch.next_check_at)}
          />
          <Fact label="Detection" value={watch.last_strategy ?? 'Not yet determined'} />
        </dl>
      </div>

      <div className="card p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Price history</h2>
          <div className="flex gap-1.5">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDays(range)}
                className={`pill transition ${
                  days === range
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300'
                }`}
              >
                {range} days
              </button>
            ))}
          </div>
        </div>
        <Suspense fallback={<div className="skeleton h-64 w-full" />}>
          <PriceChart
            points={history}
            currency={watch.currency}
            target={watch.mode === 'price' ? watch.target_price : null}
            isDark={isDark}
          />
        </Suspense>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Check log</h2>
          <Link
            to="/history"
            className="text-xs font-medium text-slate-500 transition hover:text-accent-600
              dark:text-slate-400 dark:hover:text-accent-400"
          >
            {checks.length > LOG_ROWS ? `Latest ${LOG_ROWS} · see all →` : 'See all →'}
          </Link>
        </div>
        <CheckTable checks={checks.slice(0, LOG_ROWS)} currency={watch.currency} />
      </div>

      <EditWatchModal
        open={editOpen}
        watch={watch}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setWatch(updated);
          void load();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this watch?"
        message={`"${label}" and its entire price history will be removed. This cannot be undone.`}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-slate-800 dark:text-slate-200" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function CheckTable({
  checks,
  currency,
  showWatch = false,
}: {
  checks: Array<Check & { watch_label?: string; watch_url?: string }>;
  currency: string;
  showWatch?: boolean;
}) {
  if (checks.length === 0) {
    return (
      <p className="px-6 pb-6 text-sm text-slate-500 dark:text-slate-400">
        No checks recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-slate-100 text-left text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
            <th className="px-6 py-2.5 font-medium">When</th>
            {showWatch && <th className="py-2.5 pr-4 font-medium">Watch</th>}
            <th className="py-2.5 pr-4 font-medium">Price</th>
            <th className="py-2.5 pr-4 font-medium">Stock</th>
            <th className="py-2.5 pr-4 font-medium">Took</th>
            <th className="py-2.5 pr-6 font-medium">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
          {checks.map((check) => (
            <tr
              key={check.id}
              className="transition hover:bg-slate-50/70 dark:hover:bg-white/[0.03]"
            >
              <td className="whitespace-nowrap px-6 py-2.5 text-slate-600 dark:text-slate-300">
                {formatDateTime(check.checked_at)}
              </td>
              {showWatch && (
                <td className="max-w-[14rem] truncate py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                  {check.watch_label?.trim() ||
                    (check.watch_url ? hostLabel(check.watch_url) : '—')}
                </td>
              )}
              <td className="tabular whitespace-nowrap py-2.5 pr-4 text-slate-800 dark:text-slate-200">
                {check.price === null ? '—' : formatMoney(check.price, currency)}
              </td>
              <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-400">
                {check.available === null ? '—' : check.available ? 'In stock' : 'Out'}
              </td>
              <td className="tabular whitespace-nowrap py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                {formatDuration(check.duration_ms)}
              </td>
              <td className="py-2.5 pr-6">
                {check.status === 'ok' ? (
                  <span className="pill bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300">
                    OK
                  </span>
                ) : (
                  <span
                    className="pill bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                    title={check.error_message ?? undefined}
                  >
                    {check.error_kind === 'blocked' ? 'Blocked' : 'Failed'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
