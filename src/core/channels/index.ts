/**
 * Channel registry. The checker dispatches through here and never imports a
 * concrete channel, so adding one is a single `registerChannel` call at startup.
 */

import type { Alert, AlertChannel, DispatchResult } from './types.js';

export type { Alert, AlertChannel, DispatchResult } from './types.js';
export { createEmailChannel, sendTestEmail } from './email.js';

const registry = new Map<string, AlertChannel>();

export function registerChannel(channel: AlertChannel): void {
  registry.set(channel.id, channel);
}

export function clearChannels(): void {
  registry.clear();
}

export function allChannels(): AlertChannel[] {
  return [...registry.values()];
}

/** Channels the user has finished configuring — the only ones we attempt to send on. */
export function configuredChannels(): AlertChannel[] {
  return allChannels().filter((channel) => {
    try {
      return channel.isConfigured();
    } catch {
      return false;
    }
  });
}

/**
 * Sends an alert on every configured channel. Never throws: one broken channel must
 * not stop the others, and no delivery failure may take down a check.
 */
export async function dispatchAlert(alert: Alert): Promise<DispatchResult[]> {
  const targets = configuredChannels();
  return Promise.all(
    targets.map(async (channel): Promise<DispatchResult> => {
      try {
        await channel.send(alert);
        return { channel: channel.id, ok: true };
      } catch (error) {
        return {
          channel: channel.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
