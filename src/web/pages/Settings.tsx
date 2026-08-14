import { useEffect, useState } from 'react';
import type { AppSettings, SettingsResponse } from '@shared/types';
import { INTERVAL_PRESETS } from '@shared/intervals';
import { api, ApiError } from '../api';
import { useToast } from '../components/Toast';
import { BellIcon, InfoIcon, SpinnerIcon } from '../components/icons';

interface SettingsPageProps {
  settings: SettingsResponse | null;
  onSaved: (settings: SettingsResponse) => void;
}

/** One-click fill for the two setups most self-hosters actually use. */
const SMTP_PRESETS = [
  {
    id: 'gmail',
    label: 'Gmail',
    hint: 'Use an App Password, not your account password — Google blocks plain logins.',
    values: { smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_secure: false },
  },
  {
    id: 'resend',
    label: 'Resend',
    hint: 'Username is literally "resend"; the password is your Resend API key.',
    values: {
      smtp_host: 'smtp.resend.com',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: 'resend',
    },
  },
] as const;

/** Retention windows offered in the UI. `0` disables pruning entirely. */
const RETENTION_PRESETS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days (recommended)' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: 0, label: 'Forever — never thin history' },
] as const;

type FormState = Omit<AppSettings, 'onboarding_dismissed'>;

export function Settings({ settings, onSaved }: SettingsPageProps) {
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [presetHint, setPresetHint] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    // smtp_pass is never sent to the browser; an empty field means "leave it alone".
    setForm({ ...settings, smtp_pass: '' });
  }, [settings]);

  if (!form || !settings) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-6 w-32" />
        <div className="card space-y-4 p-6">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-2/3" />
        </div>
      </div>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const applyPreset = (preset: (typeof SMTP_PRESETS)[number]): void => {
    setForm((current) => (current ? { ...current, ...preset.values } : current));
    setPresetHint(preset.hint);
  };

  /** Only send the password when the user typed one. */
  const payload = (): Partial<AppSettings> => {
    const { smtp_pass, ...rest } = form;
    return smtp_pass.trim() ? { ...rest, smtp_pass } : rest;
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await api.saveSettings({ ...payload(), onboarding_dismissed: true });
      onSaved(result.settings);
      setForm({ ...result.settings, smtp_pass: '' });
      toast.success('Settings saved.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await api.testEmail(payload());
      toast.success(`Test email sent to ${result.sent_to}.`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not send the test email.');
    } finally {
      setTesting(false);
    }
  };

  return (
    // Bottom padding keeps the sticky Save button from covering the last card.
    <div className="mx-auto max-w-2xl space-y-6 pb-16">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Stored in your local database. Nothing leaves this machine except the check requests
          themselves and the alerts you send.
        </p>
      </div>

      <section className="card p-6">
        <div className="flex items-center gap-2">
          <BellIcon className="h-4 w-4 text-accent-600 dark:text-accent-400" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Email alerts</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          DropWatch sends through your own SMTP server. Pick a preset to fill in the host.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {SMTP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn-secondary"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {presetHint && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {presetHint}
          </p>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="SMTP host" id="smtp-host" className="sm:col-span-2">
            <input
              id="smtp-host"
              className="input"
              placeholder="smtp.gmail.com"
              value={form.smtp_host}
              onChange={(event) => set('smtp_host', event.target.value)}
            />
          </Field>

          <Field label="Port" id="smtp-port">
            <input
              id="smtp-port"
              className="input tabular"
              type="number"
              value={form.smtp_port}
              onChange={(event) => set('smtp_port', Number(event.target.value))}
            />
          </Field>

          <Field label="Encryption" id="smtp-secure">
            <select
              id="smtp-secure"
              className="input"
              value={form.smtp_secure ? 'ssl' : 'starttls'}
              onChange={(event) => set('smtp_secure', event.target.value === 'ssl')}
            >
              <option value="starttls">STARTTLS (port 587)</option>
              <option value="ssl">SSL/TLS (port 465)</option>
            </select>
          </Field>

          <Field label="Username" id="smtp-user">
            <input
              id="smtp-user"
              className="input"
              autoComplete="off"
              value={form.smtp_user}
              onChange={(event) => set('smtp_user', event.target.value)}
            />
          </Field>

          <Field
            label="Password"
            id="smtp-pass"
            hint={
              settings.smtp_pass_set ? 'A password is saved. Leave blank to keep it.' : undefined
            }
          >
            <input
              id="smtp-pass"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={settings.smtp_pass_set ? '••••••••' : ''}
              value={form.smtp_pass}
              onChange={(event) => set('smtp_pass', event.target.value)}
            />
          </Field>

          <Field label="From address" id="smtp-from">
            <input
              id="smtp-from"
              className="input"
              placeholder="you@example.com"
              value={form.smtp_from}
              onChange={(event) => set('smtp_from', event.target.value)}
            />
          </Field>

          <Field label="Send alerts to" id="alert-to">
            <input
              id="alert-to"
              className="input"
              placeholder="you@example.com"
              value={form.alert_to}
              onChange={(event) => set('alert_to', event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void sendTest()}
            disabled={testing || !form.smtp_host.trim() || !form.alert_to.trim()}
          >
            {testing && <SpinnerIcon />}
            Send test email
          </button>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Defaults</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Default check frequency" id="default-interval">
            <select
              id="default-interval"
              className="input"
              value={form.default_interval_cron}
              onChange={(event) => set('default_interval_cron', event.target.value)}
            >
              {INTERVAL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.cron}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Currency" id="currency" hint="Used when a page does not state one.">
            <input
              id="currency"
              className="input uppercase"
              maxLength={3}
              value={form.currency}
              onChange={(event) => set('currency', event.target.value.toUpperCase())}
            />
          </Field>

          <Field
            label="Timezone"
            id="timezone"
            className="sm:col-span-2"
            hint="Schedules and displayed times use this zone."
          >
            <select
              id="timezone"
              className="input"
              value={form.timezone}
              onChange={(event) => set('timezone', event.target.value)}
            >
              {timezones(form.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Keep full history for"
            id="retention"
            className="sm:col-span-2"
            hint="Older checks are thinned to a daily low, high and closing price, and failed checks are dropped. Charts keep their shape; the database stops growing forever."
          >
            <select
              id="retention"
              className="input"
              value={String(form.retention_days)}
              onChange={(event) => set('retention_days', Number(event.target.value))}
            >
              {RETENTION_PRESETS.map((preset) => (
                <option key={preset.days} value={preset.days}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="card border-slate-200 bg-slate-50/60 p-5 dark:bg-white/[0.02]">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Why do some sites fail?
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Some stores actively block automated visitors. DropWatch detects that and reports it
          rather than trying to get around it — no CAPTCHA solving, no anti-bot bypass, no proxy
          rotation. For those sites, use the store’s own price-alert feature or check manually.
        </p>
      </section>

      <div className="sticky bottom-4 flex justify-end">
        <button
          type="button"
          className="btn-primary shadow-lg"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving && <SpinnerIcon />}
          Save settings
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  className = '',
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** The full IANA list when the browser exposes it, otherwise just the current zone. */
function timezones(current: string): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;

  const zones = typeof supported === 'function' ? supported('timeZone') : [];
  return zones.includes(current) ? zones : [current, ...zones];
}
