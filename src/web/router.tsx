/**
 * A ~60-line client router. The app has four routes; pulling in react-router would
 * be more dependency than the whole feature is worth.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface RouterValue {
  path: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue>({ path: '/', navigate: () => undefined });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname || '/');

  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === window.location.pathname) return;
    if (options?.replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  return useContext(RouterContext);
}

interface LinkProps {
  to: string;
  className?: string;
  children: ReactNode;
  title?: string;
}

export function Link({ to, className, children, title }: LinkProps) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      title={title}
      onClick={(event) => {
        // Let the browser handle modified clicks (new tab, download, …).
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Extracts the numeric id from `/watch/123`, or null when the path does not match. */
export function matchWatchId(path: string): number | null {
  const match = /^\/watch\/(\d+)\/?$/.exec(path);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) ? id : null;
}
