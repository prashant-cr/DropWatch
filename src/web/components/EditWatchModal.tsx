import { useEffect, useState } from 'react';
import type { WatchMode, WatchWithState } from '@shared/types';
import { INTERVAL_PRESETS, presetForCron } from '@shared/intervals';
import { api, ApiError } from '../api';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { SpinnerIcon } from './icons';

interface EditWatchModalProps {
  open: boolean;
  watch: WatchWithState;
  onClose: () => void;
  onSaved: (watch: WatchWithState) => void;
}

const CUSTOM = 'custom';

export function EditWatchModal({ open, watch, onClose, onSaved }: EditWatchModalProps) {
  const toast = useToast();

  const [label, setLabel] = useState(watch.label);
  const [mode, setMode] = useState<WatchMode>(watch.mode);
  const [target, setTarget] = useState(watch.target_price?.toString() ?? '');
  const [preset, setPreset] = useState<string>(presetForCron(watch.interval_cron)?.cron ?? CUSTOM);
  const [customCron, setCustomCron] = useState(watch.interval_cron);
  const [selector, setSelector] = useState(watch.selector_override ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(watch.label);
    setMode(watch.mode);
    setTarget(watch.target_price?.toString() ?? '');
    setPreset(presetForCron(watch.interval_cron)?.cron ?? CUSTOM);
    setCustomCron(watch.interval_cron);
    setSelector(watch.selector_override ?? '');
  }, [open, watch]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const { watch: updated } = await api.updateWatch(watch.id, {
        label: label.trim(),
        mode,
        target_price: mode === 'price' ? Number(target) : null,
        interval_cron: preset === CUSTOM ? customCron.trim() : preset,
        selector_override: selector.trim() || null,
      });
      toast.success('Watch updated.');
      onSaved(updated);
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save the watch.');
    } finally {
      setSaving(false);
    }
  };

  const targetValid = mode === 'availability' || Number(target) > 0;

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title="Edit watch"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void save()}
            disabled={saving || !targetValid}
          >
            {saving && <SpinnerIcon />}
            Save changes
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="edit-label">
            Name
          </label>
          <input
            id="edit-label"
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-mode">
            Alert on
          </label>
          <select
            id="edit-mode"
            className="input"
            value={mode}
            onChange={(event) => setMode(event.target.value as WatchMode)}
          >
            <option value="price">Price drops below target</option>
            <option value="availability">Item comes back in stock</option>
          </select>
        </div>

        {mode === 'price' && (
          <div>
            <label className="label" htmlFor="edit-target">
              Target price ({watch.currency})
            </label>
            <input
              id="edit-target"
              className="input tabular"
              type="number"
              min="0"
              step="0.01"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="edit-interval">
            Check frequency
          </label>
          <select
            id="edit-interval"
            className="input"
            value={preset}
            onChange={(event) => setPreset(event.target.value)}
          >
            {INTERVAL_PRESETS.map((option) => (
              <option key={option.id} value={option.cron}>
                {option.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom cron…</option>
          </select>
          {preset === CUSTOM && (
            <>
              <input
                className="input mt-2 font-mono text-xs"
                value={customCron}
                spellCheck={false}
                onChange={(event) => setCustomCron(event.target.value)}
                placeholder="*/30 * * * *"
              />
              <p className="hint">
                Standard five-field cron. Schedules faster than every 15 minutes are rejected.
              </p>
            </>
          )}
        </div>

        <div>
          <label className="label" htmlFor="edit-selector">
            CSS selector override
          </label>
          <input
            id="edit-selector"
            className="input font-mono text-xs"
            value={selector}
            spellCheck={false}
            placeholder="Leave empty to auto-detect"
            onChange={(event) => setSelector(event.target.value)}
          />
          <p className="hint">
            Set this only when automatic detection picks the wrong number on the page.
          </p>
        </div>
      </div>
    </Modal>
  );
}
