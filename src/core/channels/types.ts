/**
 * The one interface every alert channel implements.
 *
 * Email is simply the first implementation. To add Telegram, Discord, Slack or
 * ntfy, drop a file next to `email.ts` that exports an {@link AlertChannel} and
 * register it in `src/core/channels/index.ts` — nothing else in the codebase needs
 * to change. See CONTRIBUTING.md for a worked example.
 */

import type { AlertKind, Check, Watch } from '../../shared/types.js';

export interface Alert {
  kind: AlertKind;
  watch: Watch;
  check: Check | null;
  /** One-line summary, used as the email subject / message title. */
  subject: string;
  /** Plain-text body. Every channel must be able to render at least this. */
  body: string;
  /** Optional rich body for channels that support it. */
  html?: string;
  /** The product page. */
  url: string;
}

export interface AlertChannel {
  /** Stable identifier, stored on the `alerts` row. */
  id: string;
  /** Human-readable name shown in the UI. */
  label: string;
  /** False when the user has not finished configuring this channel. */
  isConfigured(): boolean;
  send(alert: Alert): Promise<void>;
}

export interface DispatchResult {
  channel: string;
  ok: boolean;
  error?: string;
}
