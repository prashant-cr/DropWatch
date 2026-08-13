import { useState } from 'react';
import { faviconUrl, hostLabel } from '@shared/format';

/**
 * The store's own favicon, fetched straight from the site — no third-party favicon
 * service, so nothing about what the user watches leaves the machine. Falls back to
 * the first letter of the hostname.
 */
export function StoreIcon({ url, className = 'h-5 w-5' }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostLabel(url);
  const src = faviconUrl(url);

  if (failed || !src) {
    return (
      <span
        className={`${className} flex items-center justify-center rounded bg-slate-100 text-[10px]
          font-semibold uppercase text-slate-500 dark:bg-white/10 dark:text-slate-400`}
        aria-hidden="true"
      >
        {host.charAt(0)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`${className} rounded object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
