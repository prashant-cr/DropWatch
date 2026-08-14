import type { FastifyInstance } from 'fastify';
import type { AppSettings, SettingsResponse } from '../../shared/types.js';
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from '../../core/constants.js';
import { validateSchedule } from '../../core/cron.js';
import { sendTestEmail } from '../../core/channels/index.js';
import { startScheduler } from '../../core/scheduler.js';
import { getSettings, updateSettings } from '../db/settings.js';
import {
  asRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  ValidationError,
} from '../validate.js';

/** Strips the SMTP password out of anything we hand back to the browser. */
function toResponse(settings: AppSettings): SettingsResponse {
  const { smtp_pass, ...rest } = settings;
  return { ...rest, smtp_pass_set: smtp_pass.trim() !== '' };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => ({ settings: toResponse(getSettings()) }));

  app.put('/api/settings', async (request) => {
    const body = asRecord(request.body);
    const patch: Partial<AppSettings> = {};

    const host = optionalString(body, 'smtp_host');
    if (host !== undefined) patch.smtp_host = host;

    const port = optionalNumber(body, 'smtp_port');
    if (port !== undefined && port !== null) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ValidationError('SMTP port must be between 1 and 65535.');
      }
      patch.smtp_port = port;
    }

    const secure = optionalBoolean(body, 'smtp_secure');
    if (secure !== undefined) patch.smtp_secure = secure;

    const user = optionalString(body, 'smtp_user');
    if (user !== undefined) patch.smtp_user = user;

    // Only overwrite the stored password when the user actually typed a new one;
    // the UI leaves the field blank when it is unchanged.
    const pass = optionalString(body, 'smtp_pass');
    if (pass !== undefined) patch.smtp_pass = pass;

    const from = optionalString(body, 'smtp_from');
    if (from !== undefined) patch.smtp_from = from;

    const to = optionalString(body, 'alert_to');
    if (to !== undefined) patch.alert_to = to;

    const currency = optionalString(body, 'currency');
    if (currency) patch.currency = currency.toUpperCase();

    const timezone = optionalString(body, 'timezone');
    if (timezone) {
      if (!isValidTimezone(timezone)) throw new ValidationError(`Unknown timezone "${timezone}".`);
      patch.timezone = timezone;
    }

    const interval = optionalString(body, 'default_interval_cron');
    if (interval) {
      const result = validateSchedule(interval, timezone ?? getSettings().timezone);
      if (!result.ok) throw new ValidationError(result.message ?? 'Invalid schedule.');
      patch.default_interval_cron = interval;
    }

    const retention = optionalNumber(body, 'retention_days');
    if (retention !== undefined && retention !== null) {
      if (!Number.isInteger(retention) || retention < 0 || retention > MAX_RETENTION_DAYS) {
        throw new ValidationError(
          `History retention must be between 0 and ${MAX_RETENTION_DAYS} days.`,
        );
      }
      if (retention > 0 && retention < MIN_RETENTION_DAYS) {
        throw new ValidationError(
          `Keep at least ${MIN_RETENTION_DAYS} days of history, or 0 to keep it forever.`,
        );
      }
      patch.retention_days = retention;
    }

    const dismissed = optionalBoolean(body, 'onboarding_dismissed');
    if (dismissed !== undefined) patch.onboarding_dismissed = dismissed;

    const updated = updateSettings(patch);

    // A timezone change moves every cron boundary, so rebuild the registrations.
    if (patch.timezone !== undefined) startScheduler();

    return { settings: toResponse(updated) };
  });

  app.post('/api/test-email', async (request) => {
    const body = request.body ? asRecord(request.body) : {};
    const stored = getSettings();

    // Test against whatever is currently in the form, falling back to what is saved,
    // so the button works before the user hits Save.
    const candidate = {
      ...stored,
      smtp_host: optionalString(body, 'smtp_host') ?? stored.smtp_host,
      smtp_port: (optionalNumber(body, 'smtp_port') ?? stored.smtp_port) || stored.smtp_port,
      smtp_secure: optionalBoolean(body, 'smtp_secure') ?? stored.smtp_secure,
      smtp_user: optionalString(body, 'smtp_user') ?? stored.smtp_user,
      smtp_pass: optionalString(body, 'smtp_pass') || stored.smtp_pass,
      smtp_from: optionalString(body, 'smtp_from') ?? stored.smtp_from,
      alert_to: optionalString(body, 'alert_to') ?? stored.alert_to,
    };

    if (!candidate.smtp_host.trim()) throw new ValidationError('Enter an SMTP host first.');
    if (!candidate.alert_to.trim()) throw new ValidationError('Enter a recipient address first.');

    try {
      await sendTestEmail(candidate);
    } catch (error) {
      throw new ValidationError(
        `Could not send: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { ok: true, sent_to: candidate.alert_to };
  });
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
