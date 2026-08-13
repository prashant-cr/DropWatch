import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl
          bg-accent-50 text-accent-600 dark:bg-accent-500/10 dark:text-accent-400"
      >
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5">
        <div className="skeleton h-5 w-5 rounded" />
        <div className="skeleton h-3 w-24" />
      </div>
      <div className="skeleton mt-4 h-4 w-3/4" />
      <div className="skeleton mt-2 h-4 w-1/2" />
      <div className="skeleton mt-6 h-8 w-32" />
      <div className="skeleton mt-5 h-10 w-full" />
      <div className="skeleton mt-5 h-3 w-2/3" />
    </div>
  );
}
