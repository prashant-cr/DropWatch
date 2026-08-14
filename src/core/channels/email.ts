import nodemailer, { type Transporter } from 'nodemailer';
import type { SmtpSettings } from '../../shared/types.js';
import type { Alert, AlertChannel } from './types.js';

export interface EmailChannelDeps {
  /** Read fresh on every send so Settings changes take effect without a restart. */
  getSettings: () => SmtpSettings;
}

function buildTransport(settings: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_secure,
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_pass } : undefined,
  });
}

function fromAddress(settings: SmtpSettings): string {
  const address = settings.smtp_from.trim() || settings.smtp_user.trim();
  return address.includes('<') ? address : `DropWatch <${address}>`;
}

export function createEmailChannel(deps: EmailChannelDeps): AlertChannel {
  return {
    id: 'email',
    label: 'Email',

    isConfigured() {
      const settings = deps.getSettings();
      return settings.smtp_host.trim() !== '' && settings.alert_to.trim() !== '';
    },

    async send(alert: Alert) {
      const settings = deps.getSettings();
      if (!settings.smtp_host.trim()) throw new Error('SMTP host is not configured.');
      if (!settings.alert_to.trim()) throw new Error('No alert recipient is configured.');

      const transport = buildTransport(settings);
      try {
        await transport.sendMail({
          from: fromAddress(settings),
          to: settings.alert_to,
          subject: alert.subject,
          text: `${alert.body}\n\n${alert.url}\n`,
          html: alert.html ?? defaultHtml(alert),
        });
      } finally {
        transport.close();
      }
    },
  };
}

const ACCENT = '#10b981';

/** Minimal, table-free HTML that renders acceptably in every mail client. */
function defaultHtml(alert: Alert): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;
    background:#f8fafc;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;
       border:1px solid #e2e8f0;overflow:hidden;">
    <div style="height:4px;background:${ACCENT};"></div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:18px;line-height:1.4;color:#0f172a;">
        ${escapeHtml(alert.subject)}
      </h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;white-space:pre-line;">
        ${escapeHtml(alert.body)}
      </p>
      <a href="${escapeAttr(alert.url)}"
         style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;
                padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;">
        View product
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
        Sent by DropWatch · ${escapeHtml(alert.watch.label || alert.watch.url)}
      </p>
    </div>
  </div>
</div>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

/** Used by the Settings page's "Send test email" button. */
export async function sendTestEmail(settings: SmtpSettings): Promise<void> {
  const channel = createEmailChannel({ getSettings: () => settings });
  await channel.send({
    kind: 'price',
    watch: {
      id: 0,
      url: 'https://github.com/prashant-cr/DropWatch',
      label: 'DropWatch test',
      selector_override: null,
      target_price: null,
      mode: 'price',
      interval_cron: '0 * * * *',
      currency: 'USD',
      is_paused: false,
      last_strategy: null,
      created_at: new Date().toISOString(),
    },
    check: null,
    subject: 'DropWatch test email',
    body: 'Your SMTP settings work. Price and stock alerts will arrive at this address.',
    url: 'https://github.com/prashant-cr/DropWatch',
  });
}
