import { useCallback, useEffect, useRef, useState } from 'react';
import type { WatchWithState } from '@shared/types';
import { api } from '../api';

const POLL_INTERVAL_MS = 30_000;

interface UseWatchesResult {
  watches: WatchWithState[];
  checking: Set<number>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Optimistically replaces one watch without waiting for the next poll. */
  replace: (watch: WatchWithState) => void;
  remove: (id: number) => void;
  setChecking: (id: number, value: boolean) => void;
}

/** Polls `/api/watches`; the MVP deliberately has no websocket. */
export function useWatches(): UseWatchesResult {
  const [watches, setWatches] = useState<WatchWithState[]>([]);
  const [checking, setCheckingState] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listWatches();
      if (!mounted.current) return;
      setWatches(data.watches);
      setCheckingState((current) => {
        // Union: a check started from this tab may not be visible to the server yet.
        const next = new Set(data.checking);
        for (const id of current) if (!data.watches.some((w) => w.id === id)) next.delete(id);
        return next;
      });
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : 'Could not load watches.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const timer = window.setInterval(() => {
      // Skip polling while the tab is hidden — no point burning cycles.
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_INTERVAL_MS);

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const replace = useCallback((watch: WatchWithState) => {
    setWatches((current) => {
      const exists = current.some((w) => w.id === watch.id);
      return exists ? current.map((w) => (w.id === watch.id ? watch : w)) : [watch, ...current];
    });
  }, []);

  const remove = useCallback((id: number) => {
    setWatches((current) => current.filter((w) => w.id !== id));
  }, []);

  const setChecking = useCallback((id: number, value: boolean) => {
    setCheckingState((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return { watches, checking, loading, error, refresh, replace, remove, setChecking };
}
