import { LetsBotError, toErrorCode } from './errors';
import { SDK_HEADER } from './version';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiClientOptions {
  baseUrl: string;
  appKey: string;
  appId: string;
  platform: string;
  timeoutMs: number;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  body?: unknown;
  /** Visitor token sent as `X-LB-Visitor`. */
  visitor?: string | null;
}

/** Parses `Retry-After` (seconds or HTTP date) into seconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.ceil((date - now) / 1000));
  }
  return undefined;
}

/** Thin HTTP client for `{baseUrl}/api/sdk/v1/{appKey}` (API.md §2). Never logs tokens or bodies. */
export class ApiClient {
  readonly apiBase: string;
  private readonly options: ApiClientOptions;

  constructor(options: ApiClientOptions) {
    this.options = options;
    this.apiBase = `${options.baseUrl}/api/sdk/v1/${encodeURIComponent(options.appKey)}`;
  }

  /** Headers required on every request (also sent with the WebView `ui` request). */
  baseHeaders(): Record<string, string> {
    return {
      'Accept': 'application/json',
      'X-LB-App-Id': this.options.appId,
      'X-LB-Platform': this.options.platform,
      'X-LB-SDK': SDK_HEADER,
    };
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = this.baseHeaders();
    if (options.visitor) {
      headers['X-LB-Visitor'] = options.visitor;
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, this.options.timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(`${this.apiBase}/${path}`, {
        method,
        headers,
        body,
        credentials: 'omit',
        signal: controller?.signal,
      });
    } catch (cause) {
      throw new LetsBotError(timedOut ? 'timeout' : 'network', { cause });
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const raw = (payload as { error?: unknown } | null)?.error;
      let code = toErrorCode(raw);
      if (code === 'unknown' && raw === undefined) {
        code = response.status === 404 ? 'not_found' : response.status === 429 ? 'slow_down' : 'unknown';
      }
      throw new LetsBotError(code, {
        status: response.status,
        retryAfter: parseRetryAfter(response.headers?.get?.('Retry-After')),
      });
    }
    return payload as T;
  }
}
