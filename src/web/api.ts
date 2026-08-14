import type {
  Alert,
  AppSettings,
  Check,
  CreateWatchInput,
  DetectResponse,
  PricePoint,
  SettingsResponse,
  UpdateWatchInput,
  WatchWithState,
} from '@shared/types';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body
        ? { 'content-type': 'application/json', ...init?.headers }
        : init?.headers,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the DropWatch server. Is it still running?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Body sent when creating a watch, including what the modal already detected. */
export interface CreateWatchBody extends CreateWatchInput {
  detected_price?: number | null;
  detected_available?: boolean | null;
}

export const api = {
  listWatches: () => request<{ watches: WatchWithState[]; checking: number[] }>('/api/watches'),

  getWatch: (id: number) =>
    request<{ watch: WatchWithState; checking: boolean }>(`/api/watches/${id}`),

  createWatch: (body: CreateWatchBody) =>
    request<{ watch: WatchWithState }>('/api/watches', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateWatch: (id: number, body: UpdateWatchInput) =>
    request<{ watch: WatchWithState }>(`/api/watches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteWatch: (id: number) => request<void>(`/api/watches/${id}`, { method: 'DELETE' }),

  runCheck: (id: number) =>
    request<{ check: Check; watch: WatchWithState | null }>(`/api/watches/${id}/check`, {
      method: 'POST',
    }),

  history: (id: number, days: number) =>
    request<{ days: number; points: PricePoint[] }>(`/api/watches/${id}/history?days=${days}`),

  checks: (watchId: number | null, limit = 50, offset = 0) =>
    request<{ checks: CheckWithWatch[]; total: number; limit: number; offset: number }>(
      `/api/checks?${watchId === null ? '' : `watch_id=${watchId}&`}limit=${limit}&offset=${offset}`,
    ),

  alerts: (watchId: number) => request<{ alerts: Alert[] }>(`/api/alerts?watch_id=${watchId}`),

  detect: (url: string, selectorOverride?: string | null) =>
    request<DetectResponse>('/api/detect', {
      method: 'POST',
      body: JSON.stringify({ url, selector_override: selectorOverride ?? null }),
    }),

  getSettings: () => request<{ settings: SettingsResponse }>('/api/settings'),

  saveSettings: (body: Partial<AppSettings>) =>
    request<{ settings: SettingsResponse }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  testEmail: (body: Partial<AppSettings>) =>
    request<{ ok: boolean; sent_to: string }>('/api/test-email', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

/** A check row from the global history view, carrying its watch's identity. */
export interface CheckWithWatch extends Check {
  watch_label?: string;
  watch_url?: string;
}
