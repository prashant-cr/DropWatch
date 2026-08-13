import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { XIcon } from './icons';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class. */
  size?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'max-w-lg',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog so keyboard users are not left behind it.
    panelRef.current?.querySelector<HTMLElement>('input, button, select, textarea')?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 w-full ${size} animate-slide-up rounded-t-2xl border border-slate-200
          bg-white shadow-xl sm:rounded-2xl dark:border-white/10 dark:bg-[#14171c]
          max-h-[92vh] overflow-y-auto`}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-2 -mt-1 rounded-lg p-2"
            aria-label="Close"
          >
            <XIcon />
          </button>
        </div>

        <div className="px-5 py-5 sm:px-6">{children}</div>

        {footer && (
          <div
            className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4
              sm:flex-row sm:justify-end sm:px-6 dark:border-white/10"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
