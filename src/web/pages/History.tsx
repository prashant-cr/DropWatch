import { useEffect, useState } from 'react';
import { api, type CheckWithWatch } from '../api';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { HistoryIcon } from '../components/icons';
import { CheckTable } from './WatchDetail';

const PAGE_SIZE = 50;

/** Every check across every watch — the audit trail for "did it actually run?". */
export function History({ currency }: { currency: string }) {
  const toast = useToast();
  const [checks, setChecks] = useState<CheckWithWatch[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    api
      .checks(null, PAGE_SIZE, offset)
      .then((result) => {
        if (!active) return;
        setChecks(result.checks);
        setTotal(result.total);
      })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof Error ? error.message : 'Could not load history.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [offset, toast]);

  const lastPage = offset + PAGE_SIZE >= total;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Check history
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {loading ? 'Loading…' : `${total} check${total === 1 ? '' : 's'} recorded`}
        </p>
      </div>

      {loading ? (
        <div className="card space-y-3 p-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton h-6 w-full" />
          ))}
        </div>
      ) : checks.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon className="h-6 w-6" />}
          title="No checks yet"
          description="Once a watch runs — on its schedule or via “Check now” — every attempt is logged here."
        />
      ) : (
        <>
          <div className="card overflow-hidden py-2">
            <CheckTable checks={checks} currency={currency} showWatch />
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="btn-secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={lastPage}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
