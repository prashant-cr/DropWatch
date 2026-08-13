import type { WatchWithState } from '@shared/types';
import { formatMoney, formatRelativeShort, hostLabel, percentChange } from '@shared/format';
import { Link } from '../router';
import { watchStatus } from '../status';
import { Sparkline } from './Sparkline';
import { StatusPill } from './StatusPill';
import { StoreIcon } from './StoreIcon';
import { PauseIcon, PlayIcon, RefreshIcon, SpinnerIcon, TrendDownIcon, TrendUpIcon } from './icons';

interface WatchCardProps {
  watch: WatchWithState;
  isChecking: boolean;
  onRunCheck: (id: number) => void;
  onTogglePause: (watch: WatchWithState) => void;
}

export function WatchCard({ watch, isChecking, onRunCheck, onTogglePause }: WatchCardProps) {
  const status = watchStatus(watch, isChecking);
  const price = watch.last_check?.status === 'ok' ? watch.last_check.price : null;
  const change = percentChange(watch.previous_price, price);
  const label = watch.label.trim() || hostLabel(watch.url);

  return (
    <div
      className={`card group relative flex flex-col p-5 transition
        hover:border-slate-300 hover:shadow-md dark:hover:border-white/20
        ${watch.is_paused ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StoreIcon url={watch.url} />
          <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
            {hostLabel(watch.url)}
          </span>
        </div>
        <StatusPill status={status} />
      </div>

      <Link
        to={`/watch/${watch.id}`}
        className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900
          transition hover:text-accent-600 dark:text-white dark:hover:text-accent-400"
        title={label}
      >
        {label}
      </Link>

      <div className="mt-4 flex items-baseline gap-2.5">
        <span className="tabular text-[28px] font-semibold leading-none tracking-tight text-slate-900 dark:text-white">
          {watch.mode === 'availability' && price === null
            ? watch.last_check?.available
              ? 'In stock'
              : '—'
            : formatMoney(price, watch.currency)}
        </span>
        {change !== null && Math.abs(change) >= 0.5 && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              change < 0
                ? 'text-accent-600 dark:text-accent-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {change < 0 ? (
              <TrendDownIcon className="h-3.5 w-3.5" />
            ) : (
              <TrendUpIcon className="h-3.5 w-3.5" />
            )}
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>

      {watch.mode === 'price' && watch.target_price !== null && (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Target {formatMoney(watch.target_price, watch.currency)}
        </p>
      )}
      {watch.mode === 'availability' && (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Alerting when back in stock
        </p>
      )}

      <div className="mt-4 -mx-1">
        <Sparkline points={watch.sparkline} target={watch.target_price} />
      </div>

      {status.tone === 'bad' && (
        <p
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-300"
          title={status.detail}
        >
          {status.short ?? status.detail}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <p className="min-w-0 truncate text-xs text-slate-400 dark:text-slate-500">
          {watch.last_check
            ? `Checked ${formatRelativeShort(watch.last_check.checked_at)}`
            : 'Not checked yet'}
          {watch.is_paused
            ? ' · paused'
            : watch.next_check_at
              ? ` · next ${formatRelativeShort(watch.next_check_at)}`
              : ''}
        </p>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            className="btn-ghost rounded-lg p-2"
            onClick={() => onTogglePause(watch)}
            title={watch.is_paused ? 'Resume checking' : 'Pause checking'}
            aria-label={watch.is_paused ? 'Resume checking' : 'Pause checking'}
          >
            {watch.is_paused ? (
              <PlayIcon className="h-3.5 w-3.5" />
            ) : (
              <PauseIcon className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="btn-ghost rounded-lg p-2"
            onClick={() => onRunCheck(watch.id)}
            disabled={isChecking}
            title="Check now"
            aria-label="Check now"
          >
            {isChecking ? (
              <SpinnerIcon className="h-3.5 w-3.5" />
            ) : (
              <RefreshIcon className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
