import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DetectResponse, WatchMode, WatchWithState } from '@shared/types';
import { formatMoney, hostLabel } from '@shared/format';
import { INTERVAL_PRESETS } from '@shared/intervals';
import { api, ApiError } from '../api';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { SpinnerIcon, WarningIcon } from './icons';
import { StoreIcon } from './StoreIcon';

interface AddWatchModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (watch: WatchWithState) => void;
  defaultIntervalCron: string;
}

type Phase = 'idle' | 'detecting' | 'detected' | 'failed';

const DETECT_DEBOUNCE_MS = 700;

function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4 || /\s/.test(trimmed)) return false;
  return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed);
}

/** Sensible opening bid for a target: a little under what the item costs today. */
function suggestTarget(price: number): number {
  const suggestion = price * 0.9;
  return suggestion >= 20 ? Math.floor(suggestion) : Math.round(suggestion * 100) / 100;
}

export function AddWatchModal({
  open,
  onClose,
  onCreated,
  defaultIntervalCron,
}: AddWatchModalProps) {
  const toast = useToast();

  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [detection, setDetection] = useState<DetectResponse | null>(null);
  const [mode, setMode] = useState<WatchMode>('price');
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const [intervalCron, setIntervalCron] = useState(defaultIntervalCron);
  const [selector, setSelector] = useState('');
  const [showSelector, setShowSelector] = useState(false);
  const [saving, setSaving] = useState(false);

  // Guards against a slow earlier detection overwriting a newer one.
  const detectionSeq = useRef(0);

  const reset = useCallback(() => {
    detectionSeq.current++;
    setUrl('');
    setPhase('idle');
    setDetection(null);
    setMode('price');
    setTarget('');
    setLabel('');
    setSelector('');
    setShowSelector(false);
    setIntervalCron(defaultIntervalCron);
    setSaving(false);
  }, [defaultIntervalCron]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const runDetection = useCallback(async (candidate: string, selectorOverride: string) => {
    const seq = ++detectionSeq.current;
    setPhase('detecting');
    try {
      const result = await api.detect(candidate, selectorOverride || null);
      if (seq !== detectionSeq.current) return;

      setDetection(result);
      setPhase(result.ok ? 'detected' : 'failed');
      if (result.title) setLabel((current) => current || result.title || '');
      if (result.price !== null) {
        setTarget(String(suggestTarget(result.price)));
        setMode('price');
      } else if (result.ok) {
        // A page with stock information but no price is an availability watch.
        setMode('availability');
      }
    } catch (error) {
      if (seq !== detectionSeq.current) return;
      setPhase('failed');
      setDetection({
        ok: false,
        url: candidate,
        title: null,
        price: null,
        currency: null,
        available: null,
        strategy: null,
        favicon: null,
        error_kind: 'unknown',
        error_message: error instanceof Error ? error.message : 'Detection failed.',
      });
    }
  }, []);

  // Auto-detect shortly after the user finishes pasting.
  useEffect(() => {
    if (!open || !looksLikeUrl(url)) return;
    const timer = window.setTimeout(() => void runDetection(url, selector), DETECT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `selector` intentionally excluded: it re-runs through its own Retry button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, open, runDetection]);

  const detectedPrice = detection?.price ?? null;

  const sliderBounds = useMemo(() => {
    if (detectedPrice === null) return null;
    return { min: Math.max(0.01, detectedPrice * 0.1), max: detectedPrice };
  }, [detectedPrice]);

  const targetNumber = Number(target);
  const targetValid =
    mode === 'availability' || (Number.isFinite(targetNumber) && targetNumber > 0);
  const canSubmit = looksLikeUrl(url) && targetValid && !saving && phase !== 'detecting';

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const { watch } = await api.createWatch({
        url: detection?.url ?? url,
        label: label.trim(),
        mode,
        target_price: mode === 'price' ? targetNumber : null,
        interval_cron: intervalCron,
        currency: detection?.currency ?? undefined,
        selector_override: selector.trim() || null,
        detected_price: detectedPrice,
        detected_available: detection?.available ?? null,
      });
      toast.success(`Now watching ${watch.label || hostLabel(watch.url)}.`);
      onCreated(watch);
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not create the watch.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title="Watch a product"
      description="Paste a product URL — DropWatch will find the name and price for you."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {saving && <SpinnerIcon />}
            Start watching
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="watch-url">
            Product URL
          </label>
          <input
            id="watch-url"
            className="input"
            placeholder="https://store.example.com/products/…"
            value={url}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>

        {phase === 'detecting' && <DetectingState url={url} />}

        {phase === 'detected' && detection && (
          <DetectedState detection={detection} label={label} onLabelChange={setLabel} />
        )}

        {phase === 'failed' && detection && (
          <FailedState
            message={detection.error_message ?? 'Could not read that page.'}
            blocked={detection.error_kind === 'blocked'}
            onRetry={() => void runDetection(url, selector)}
          />
        )}

        {(phase === 'detected' || phase === 'failed') && (
          <>
            <div>
              <span className="label">What should trigger an alert?</span>
              <div className="grid grid-cols-2 gap-2">
                <ModeButton
                  active={mode === 'price'}
                  onClick={() => setMode('price')}
                  title="Price drops"
                  subtitle="Alert below a target"
                />
                <ModeButton
                  active={mode === 'availability'}
                  onClick={() => setMode('availability')}
                  title="Back in stock"
                  subtitle="Alert when available"
                />
              </div>
            </div>

            {mode === 'price' && (
              <TargetPicker
                target={target}
                onTargetChange={setTarget}
                currency={detection?.currency ?? 'USD'}
                currentPrice={detectedPrice}
                bounds={sliderBounds}
              />
            )}

            <div>
              <label className="label" htmlFor="watch-interval">
                Check frequency
              </label>
              <select
                id="watch-interval"
                className="input"
                value={intervalCron}
                onChange={(event) => setIntervalCron(event.target.value)}
              >
                {INTERVAL_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.cron}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <button
                type="button"
                className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
                onClick={() => setShowSelector((value) => !value)}
              >
                {showSelector ? 'Hide' : 'Price not right?'} CSS selector override
              </button>
              {showSelector && (
                <div className="mt-2">
                  <div className="flex gap-2">
                    <input
                      className="input"
                      placeholder=".product-price .amount"
                      value={selector}
                      spellCheck={false}
                      onChange={(event) => setSelector(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      onClick={() => void runDetection(url, selector)}
                    >
                      Retry
                    </button>
                  </div>
                  <p className="hint">
                    Right-click the price on the page → Inspect, then copy a selector that matches
                    the element containing it.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function DetectingState({ url }: { url: string }) {
  return (
    <div className="card flex items-center gap-3 border-dashed p-4">
      <SpinnerIcon className="h-4 w-4 text-accent-500" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Detecting…</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          Loading {hostLabel(url)} and looking for a price.
        </p>
      </div>
    </div>
  );
}

function DetectedState({
  detection,
  label,
  onLabelChange,
}: {
  detection: DetectResponse;
  label: string;
  onLabelChange: (value: string) => void;
}) {
  return (
    <div className="card animate-fade-in space-y-3 p-4">
      <div className="flex items-start gap-3">
        <StoreIcon url={detection.url} className="mt-0.5 h-6 w-6" />
        <div className="min-w-0 flex-1">
          <input
            className="w-full border-0 bg-transparent p-0 text-sm font-semibold text-slate-900
              focus:ring-0 dark:text-white"
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            aria-label="Product name"
          />
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {hostLabel(detection.url)}
            {detection.strategy ? ` · found via ${detection.strategy}` : ''}
          </p>
        </div>
      </div>

      <div className="flex items-baseline gap-3 border-t border-slate-100 pt-3 dark:border-white/10">
        {detection.price !== null ? (
          <span className="tabular text-2xl font-semibold text-slate-900 dark:text-white">
            {formatMoney(detection.price, detection.currency ?? 'USD')}
          </span>
        ) : (
          <span className="text-sm text-slate-500 dark:text-slate-400">No price found</span>
        )}
        {detection.available !== null && (
          <span
            className={`pill ${
              detection.available
                ? 'bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300'
                : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-400'
            }`}
          >
            {detection.available ? 'In stock' : 'Out of stock'}
          </span>
        )}
      </div>

      {detection.price === null && detection.error_message && (
        <p className="hint !mt-2">{detection.error_message}</p>
      )}
    </div>
  );
}

function FailedState({
  message,
  blocked,
  onRetry,
}: {
  message: string;
  blocked: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={`card animate-fade-in flex gap-3 p-4 ${
        blocked ? 'border-amber-300/60 bg-amber-50/60 dark:bg-amber-500/5' : ''
      }`}
    >
      <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {blocked ? 'This site blocks automated checking' : 'Could not read that page'}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{message}</p>
        {!blocked && (
          <button
            type="button"
            className="mt-2 text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
            onClick={onRetry}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        active
          ? 'border-accent-500 bg-accent-50 dark:border-accent-500/60 dark:bg-accent-500/10'
          : 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5'
      }`}
    >
      <span
        className={`block text-sm font-medium ${
          active ? 'text-accent-700 dark:text-accent-300' : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        {title}
      </span>
      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{subtitle}</span>
    </button>
  );
}

function TargetPicker({
  target,
  onTargetChange,
  currency,
  currentPrice,
  bounds,
}: {
  target: string;
  onTargetChange: (value: string) => void;
  currency: string;
  currentPrice: number | null;
  bounds: { min: number; max: number } | null;
}) {
  const numeric = Number(target);
  const discount =
    currentPrice && Number.isFinite(numeric) && numeric > 0
      ? Math.round((1 - numeric / currentPrice) * 100)
      : null;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="label !mb-0" htmlFor="watch-target">
          Alert me below
        </label>
        {discount !== null && discount > 0 && (
          <span className="text-xs font-medium text-accent-600 dark:text-accent-400">
            {discount}% off today’s price
          </span>
        )}
      </div>

      <input
        id="watch-target"
        className="input tabular"
        type="number"
        min="0"
        step="0.01"
        value={target}
        onChange={(event) => onTargetChange(event.target.value)}
      />

      {bounds && currentPrice !== null && (
        <>
          <input
            type="range"
            className="mt-3 w-full accent-accent-500"
            min={bounds.min}
            max={bounds.max}
            step={bounds.max > 50 ? 1 : 0.01}
            value={Math.min(Math.max(numeric || bounds.max, bounds.min), bounds.max)}
            onChange={(event) => onTargetChange(event.target.value)}
            aria-label="Target price"
          />
          <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>{formatMoney(bounds.min, currency)}</span>
            <span>Now {formatMoney(currentPrice, currency)}</span>
          </div>
        </>
      )}
    </div>
  );
}
