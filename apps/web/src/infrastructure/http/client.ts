import { API_PREFIX, routes, type ApiError, type ApiErrorCode } from '@zelo/contracts';
import { DataError, OfflineError } from '@/shared/data/ports';
import { getDeviceId } from '@/pwa/device';

export type Query = Record<string, string | number | boolean | undefined | null>;

const CSRF_COOKIE = 'zelo_csrf';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'VERSION_CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL_ERROR';
}

/**
 * Same-origin JSON client for /api/v1 (Next rewrites to the API).
 * - credentials: include (HttpOnly session cookie)
 * - CSRF double submit: header x-csrf-token = cookie zelo_csrf on non-GET
 * - x-device-id header on every request
 * - non-2xx → DataError; network failure → OfflineError
 */
export class HttpClient {
  private csrfPromise: Promise<string | null> | null = null;

  constructor(private readonly base = API_PREFIX) {}

  private async csrfToken(force = false): Promise<string | null> {
    if (!force) {
      const c = readCookie(CSRF_COOKIE);
      if (c) return c;
    }
    if (!this.csrfPromise || force) {
      this.csrfPromise = (async () => {
        try {
          const res = await fetch(`${this.base}${routes.auth.csrf}`, { credentials: 'include', cache: 'no-store' });
          let token: string | null = null;
          if (res.ok) {
            try {
              const body = (await res.json()) as { csrfToken?: string };
              token = body.csrfToken ?? null;
            } catch {
              /* ignore */
            }
          }
          return readCookie(CSRF_COOKIE) ?? token;
        } catch {
          throw new OfflineError();
        } finally {
          setTimeout(() => (this.csrfPromise = null), 0);
        }
      })();
    }
    return this.csrfPromise;
  }

  async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}, retried = false): Promise<T> {
    let url = `${this.base}${path}`;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    const deviceId = getDeviceId();
    if (deviceId) headers['x-device-id'] = deviceId;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
      const token = await this.csrfToken();
      if (token) headers['x-csrf-token'] = token;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new OfflineError();
    }

    if (res.status === 204) return null as T;
    let payload: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!res.ok) {
      const body = toApiError(res.status, payload);
      if (body.code === 'CSRF_FAILED' && !retried) {
        await this.csrfToken(true);
        return this.request<T>(method, path, opts, true);
      }
      throw new DataError(res.status, body);
    }
    return payload as T;
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  if (payload && typeof payload === 'object' && 'code' in payload && 'message' in payload) {
    const p = payload as ApiError;
    return { ...p, correlationId: p.correlationId ?? '' };
  }
  return {
    code: codeForStatus(status),
    message: status >= 500 ? 'O serviço está indisponível no momento. Tente novamente.' : 'Não foi possível concluir a ação.',
    correlationId: '',
  };
}
