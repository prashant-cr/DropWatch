import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PricePoint } from '@shared/types';
import { formatDateTime, formatMoney } from '@shared/format';

interface PriceChartProps {
  points: PricePoint[];
  currency: string;
  target?: number | null;
  isDark: boolean;
}

/**
 * Rounds the axis range outward to a round step so ticks read as $950 / $1,000
 * rather than as whatever prices happen to sit at the extremes. Price charts do not
 * start at zero — the interesting movement is a few percent wide.
 */
function niceScale(min: number, max: number): { domain: [number, number]; ticks: number[] } {
  const range = max - min || Math.abs(max) * 0.05 || 1;
  const padded = range * 1.16;
  const magnitude = 10 ** Math.floor(Math.log10(padded / 4));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => padded / candidate <= 5) ??
    magnitude;

  const low = Math.floor((min - range * 0.08) / step) * step;
  const high = Math.ceil((max + range * 0.08) / step) * step;

  // Explicit ticks — left to itself Recharts drops interior ones and leaves an
  // uneven ladder (…965, 1030, 1150).
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return { domain: [low, high], ticks };
}

/**
 * Price over time — one series, so no legend: the surrounding heading names it.
 * Dark-mode colours are chosen against the dark surface rather than flipped, and
 * the check-log table below the chart is the non-visual view of the same data.
 */
export function PriceChart({ points, currency, target, isDark }: PriceChartProps) {
  const data = points
    .filter((point): point is PricePoint & { price: number } => point.price !== null)
    .map((point) => ({ t: Date.parse(point.checked_at), price: point.price }));

  if (data.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        {data.length === 1
          ? 'One check so far — the chart appears once there are two.'
          : 'No price history yet.'}
      </div>
    );
  }

  // Emerald reads as the accent in both modes, but each mode gets its own step so
  // the line keeps its contrast against that surface.
  const series = isDark ? '#34d399' : '#059669';
  const axisInk = isDark ? '#64748b' : '#94a3b8';
  const grid = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)';

  const prices = data.map((d) => d.price);
  const candidates = target !== null && target !== undefined ? [...prices, target] : prices;
  const { domain, ticks } = niceScale(Math.min(...candidates), Math.max(...candidates));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) =>
              new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            }
            tick={{ fill: axisInk, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            tickFormatter={(value: number) => formatMoney(value, currency)}
            tick={{ fill: axisInk, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={72}
          />
          <Tooltip
            cursor={{ stroke: axisInk, strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as { t: number; price: number } | undefined;
              if (!active || !point) return null;
              return (
                <div className="card px-3 py-2 shadow-lg">
                  <p className="tabular text-sm font-semibold text-slate-900 dark:text-white">
                    {formatMoney(point.price, currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatDateTime(new Date(point.t).toISOString())}
                  </p>
                </div>
              );
            }}
          />
          {target !== null && target !== undefined && (
            <ReferenceLine
              y={target}
              stroke={axisInk}
              strokeDasharray="4 4"
              label={{
                value: `Target ${formatMoney(target, currency)}`,
                position: 'insideTopLeft',
                fill: axisInk,
                fontSize: 11,
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="price"
            stroke={series}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: isDark ? '#0b0d10' : '#ffffff' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
