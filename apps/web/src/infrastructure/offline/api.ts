/**
 * Minimal same-origin client for the sync/push endpoints used by the offline layer.
 * Same conventions as the app HTTP client: credentials included, CSRF double-submit
 * (cookie `zelo_csrf` → header `x-csrf-token`, GET /auth/csrf when missing), `x-device-id`.
 * Network failure → OfflineError; non-2xx → DataError.
 */
import {
  API_PREFIX,
  routes,
  type ApiError,
  type ApiErrorCode,
  type PushConfigResponse,
  type PushSubscriptionRequest,
  type PushSubscriptionResponse,
  type SyncBootstrapResponse,
  type SyncChangesResponse,
  type SyncOperation,
  type SyncOperationsResponse,
} from '@zelo/contracts';
import { DataError, OfflineError } from '@/shared/data/ports';
import { getDeviceId } from '@/pwa/device';

export interface SyncApi {
  bootstrap(): Promise<SyncBootstrapResponse>;
  changes(cursor: string): Promise<SyncChangesResponse>;
  operations(ops: SyncOperation[]): Promise<SyncOperationsResponse>;
  pushConfig(): Promise<PushConfigResponse>;
  pushSubscribe(body: PushSubscriptionRequest): Promise<PushSubscriptionResponse>;
  pushUnsubscribe(id: string): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function codeFor(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'VERSION_CONFLICT';
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL_ERROR';
}

export function createFetchSyncApi(fetchImpl?: FetchLike, base = API_PREFIX): SyncApi {
  const doFetch: FetchLike = (i, init) => (fetchImpl ?? globalThis.fetch)(i, init);

  async function csrf(): Promise<string | null> {
    const c = readCookie('zelo_csrf');
    if (c) return c;
    try {
      const res = await doFetch(`${base}${routes.auth.csrf}`, { credentials: 'include', cache: 'no-store' });
      const body = res.ok ? ((await res.json().catch(() => ({}))) as { csrfToken?: string }) : {};
      return readCookie('zelo_csrf') ?? body.csrfToken ?? null;
    } catch {
      throw new OfflineError();
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', 'x-device-id': getDeviceId() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      const t = await csrf();
      if (t) headers['x-csrf-token'] = t;
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new OfflineError();
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-json */
    }
    if (!res.ok) {
      const err = (json && typeof json === 'object' && 'code' in json ? json : null) as ApiError | null;
      throw new DataError(
        res.status,
        err ?? { code: codeFor(res.status), message: 'Erro ao comunicar com o servidor.', correlationId: 'local' },
      );
    }
    return json as T;
  }

  return {
    bootstrap: () => request('GET', routes.syncBootstrap),
    changes: (cursor) => request('GET', `${routes.syncChanges}?cursor=${encodeURIComponent(cursor)}`),
    operations: (operations) => request('POST', routes.syncOperations, { operations }),
    pushConfig: () => request('GET', routes.pushConfig),
    pushSubscribe: (body) => request('POST', routes.pushSubscriptions, body),
    pushUnsubscribe: (id) => request('DELETE', routes.pushSubscription(id)),
  };
}
