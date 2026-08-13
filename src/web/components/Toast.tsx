import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircleIcon, InfoIcon, WarningIcon, XIcon } from './icons';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
});

const DISMISS_AFTER_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE_STYLES: Record<ToastTone, string> = {
  success:
    'border-accent-500/30 bg-accent-50 text-accent-900 dark:bg-accent-500/10 dark:text-accent-100',
  error: 'border-red-500/30 bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-100',
  info: 'border-slate-200 bg-white text-slate-800 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100',
};

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon =
    toast.tone === 'success' ? CheckCircleIcon : toast.tone === 'error' ? WarningIcon : InfoIcon;

  return (
    <div
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border
        px-4 py-3 text-sm shadow-lg animate-slide-up ${TONE_STYLES[toast.tone]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 leading-relaxed">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="-mr-1 -mt-0.5 rounded p-1 opacity-60 transition hover:opacity-100"
        aria-label="Dismiss"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
