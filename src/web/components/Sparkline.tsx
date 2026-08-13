import { useId } from 'react';
import type { PricePoint } from '@shared/types';

interface SparklineProps {
  points: PricePoint[];
  /** Draws a dashed line at the target price when it falls inside the range. */
  target?: number | null;
  className?: string;
}

/**
 * A hand-rolled SVG sparkline rather than a Recharts chart: at 40px tall with no
 * axes, tooltips or legend, a chart library would cost far more than it gives. The
 * full history chart on the detail page does use Recharts.
 */
export function Sparkline({ points, target, className = '' }: SparklineProps) {
  const gradientId = useId();
  const values = points.filter((p): p is PricePoint & { price: number } => p.price !== null);

  if (values.length < 2) {
    return (
      <div
        className={`flex h-10 items-center text-xs text-slate-400 dark:text-slate-500 ${className}`}
      >
        {values.length === 1 ? 'Collecting history…' : 'No history yet'}
      </div>
    );
  }

  const width = 240;
  const height = 40;
  const padding = 3;

  const prices = values.map((p) => p.price);
  const candidates = target !== null && target !== undefined ? [...prices, target] : prices;
  const min = Math.min(...candidates);
  const max = Math.max(...candidates);
  const span = max - min || Math.max(1, max * 0.05);

  const x = (index: number): number =>
    padding + (index / (values.length - 1)) * (width - padding * 2);
  const y = (price: number): number =>
    height - padding - ((price - min) / span) * (height - padding * 2);

  const line = values.map((point, index) => `${x(index)},${y(point.price)}`).join(' ');
  const area = `${padding},${height} ${line} ${width - padding},${height}`;

  const first = prices[0] ?? 0;
  const last = prices[prices.length - 1] ?? 0;
  // Emerald when the price has fallen — a drop is the good news this tool exists for.
  const stroke = last <= first ? '#10b981' : '#94a3b8';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-10 w-full ${className}`}
      role="img"
      aria-label={`Price trend over the last ${values.length} checks`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>

      <polygon points={area} fill={`url(#${gradientId})`} />

      {target !== null && target !== undefined && target >= min && target <= max && (
        <line
          x1={padding}
          x2={width - padding}
          y1={y(target)}
          y2={y(target)}
          stroke="currentColor"
          className="text-slate-300 dark:text-slate-600"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}

      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.5} fill={stroke} />
    </svg>
  );
}
