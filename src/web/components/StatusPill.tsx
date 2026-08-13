import { TONE_CLASSES, type WatchStatus } from '../status';
import { SpinnerIcon } from './icons';

export function StatusPill({ status }: { status: WatchStatus }) {
  return (
    <span className={`pill ${TONE_CLASSES[status.tone]}`} title={status.detail}>
      {status.label === 'Checking…' ? (
        <SpinnerIcon className="h-3 w-3" />
      ) : (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status.tone === 'good'
              ? 'bg-accent-500'
              : status.tone === 'bad'
                ? 'bg-red-500'
                : status.tone === 'warn'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'
          }`}
        />
      )}
      {status.label}
    </span>
  );
}
