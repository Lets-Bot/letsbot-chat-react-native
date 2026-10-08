/**
 * Local in-memory mock of the LetsBot SDK API (API.md §2–§4), installed as `globalThis.fetch`.
 */

export interface RecordedRequest {
  method: string;
  url: string;
  path: string;
  route: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Override = (req: RecordedRequest) => MockReply | undefined | Promise<MockReply | undefined>;

export const APP_KEY = 'pk_test_123';
export const APP_ID = 'com.acme.app';

let tokenSeq = 0;
const newToken = () => {
  tokenSeq += 1;
  return `${'a'.repeat(39)}${tokenSeq % 10}.${'b'.repeat(43)}`;
};

export class MockLetsBotServer {
  readonly requests: RecordedRequest[] = [];
  readonly visitors = new Set<string>();
  readonly devices = new Map<string, Record<string, unknown>>();
  unreadCount = 0;
  registeredAppIds = new Set<string>([APP_ID]);
  appKeys = new Set<string>([APP_KEY]);
  private overrides: Override[] = [];
  /** When set, fetch never resolves until aborted (timeout tests). */
  hang = false;
  /** When set, fetch rejects as if offline. */
  offline = false;

  readonly fetch = jest.fn(async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) {
      throw new TypeError('Network request failed');
    }
    if (this.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }
    const headers = { ...(init.headers as Record<string, string>) };
    const match = /\/api\/sdk\/v1\/([^/]+)\/([^?]+)/.exec(input);
    const req: RecordedRequest = {
      method: init.method ?? 'GET',
      url: input,
      path: match ? match[2]! : '',
      route: `${init.method ?? 'GET'} ${match ? match[2] : ''}`,
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    this.requests.push(req);
    for (const override of this.overrides) {
      const reply = await override(req);
      if (reply) {
        return this.respond(reply);
      }
    }
    return this.respond(this.handle(match ? decodeURIComponent(match[1]!) : '', req));
  });

  install(): void {
    (globalThis as { fetch: unknown }).fetch = this.fetch;
  }

  /** Adds a one-off or persistent override. Return undefined to fall through. */
  use(override: Override): void {
    this.overrides.push(override);
  }

  routes(): string[] {
    return this.requests.map((r) => r.route);
  }

  private respond({ status, body, headers }: MockReply): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', ...headers },
    });
  }

  private handle(appKey: string, req: RecordedRequest): MockReply {
    if (!this.appKeys.has(appKey)) {
      return { status: 404, body: { error: 'not_found' } };
    }
    if (!this.registeredAppIds.has(req.headers['X-LB-App-Id'] ?? '')) {
      return { status: 403, body: { error: 'app_not_registered' } };
    }
    if (req.route === 'GET config') {
      return { status: 200, body: { title: 'Acme Support', color: '#0e7c66' } };
    }
    if (req.route === 'POST session') {
      const existing = req.headers['X-LB-Visitor'];
      const token = existing && this.visitors.has(existing) ? existing : newToken();
      this.visitors.add(token);
      return { status: 200, body: { token } };
    }
    const visitor = req.headers['X-LB-Visitor'];
    if (!visitor || !this.visitors.has(visitor)) {
      return { status: 401, body: { error: 'invalid_visitor' } };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    switch (req.route) {
      case 'POST identify':
        if (body.identity_token === 'expired') {
          return { status: 401, body: { error: 'identity_expired' } };
        }
        if (typeof body.identity_token !== 'string' || body.identity_token.split('.').length !== 3) {
          return { status: 401, body: { error: 'identity_invalid' } };
        }
        return { status: 200, body: { verified: true } };
      case 'POST logout':
        for (const [token, device] of this.devices) {
          if (device.visitor === visitor) {
            this.devices.delete(token);
          }
        }
        this.visitors.delete(visitor);
        return { status: 200, body: { ok: true } };
      case 'PUT device':
        this.devices.set(String(body.token), { ...body, visitor });
        return { status: 200, body: { ok: true } };
      case 'DELETE device':
        this.devices.delete(String(body.token));
        return { status: 200, body: { ok: true } };
      case 'GET unread':
        return {
          status: 200,
          body: {
            count: this.unreadCount,
            last: this.unreadCount > 0 ? { t: 'Your order shipped', at: '2026-10-08T12:00:00+03:00' } : null,
          },
        };
      default:
        return { status: 404, body: { error: 'not_found' } };
    }
  }
}

/** Lets pending promise callbacks run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
