import { LetsBotCore } from '../src/core';
import { LetsBotError } from '../src/errors';
import { createMemoryStorageAdapter, storageKey } from '../src/storage';
import type { StorageAdapter } from '../src/storage';
import type { LetsBotConfig } from '../src/types';
import { SDK_HEADER } from '../src/version';
import { Platform, __mock } from './mocks/react-native';
import { APP_ID, APP_KEY, MockLetsBotServer, flush } from './helpers/mockServer';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln';

let server: MockLetsBotServer;
let storage: StorageAdapter;
let core: LetsBotCore;

function configure(extra: Partial<LetsBotConfig> = {}): void {
  core.configure({ appKey: APP_KEY, appId: APP_ID, appVersion: '2.3.0', locale: 'en', storage, ...extra });
}

beforeEach(() => {
  server = new MockLetsBotServer();
  server.install();
  storage = createMemoryStorageAdapter();
  core = new LetsBotCore();
  Platform.OS = 'ios';
});

afterEach(() => {
  core.reset();
});

describe('configure', () => {
  it('validates required options', () => {
    expect(() => core.configure({ appKey: '', appId: APP_ID })).toThrow(LetsBotError);
    expect(() => core.configure({ appKey: APP_KEY, appId: ' ' })).toThrow(/appId/);
    expect(() => core.configure({ appKey: APP_KEY, appId: APP_ID, baseUrl: 'ftp://x' })).toThrow(/baseUrl/);
    expect(() => core.configure({ appKey: APP_KEY, appId: APP_ID, color: 'red' })).toThrow(/color/);
    expect(() =>
      core.configure({ appKey: APP_KEY, appId: APP_ID, theme: 'blue' as never })
    ).toThrow(/theme/);
  });

  it('rejects calls before configure with not_configured', async () => {
    await expect(core.identify({ userId: 'u', identityToken: JWT })).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(core.refreshUnread()).rejects.toMatchObject({ code: 'not_configured' });
    await expect(core.setPushToken('t')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('builds the hosted ui URL and headers', () => {
    configure({ baseUrl: 'https://staging.letsbot.net/', locale: 'ar-SA', theme: 'dark' });
    expect(core.uiUrl()).toBe(
      `https://staging.letsbot.net/api/sdk/v1/${APP_KEY}/ui?l=ar&theme=dark&p=ios`
    );
    expect(core.uiHeaders()).toMatchObject({
      'X-LB-App-Id': APP_ID,
      'X-LB-Platform': 'ios',
      'X-LB-SDK': 'react-native/0.1.0',
    });
  });

  it('does not create a session on startup', async () => {
    configure();
    await flush();
    expect(server.requests).toHaveLength(0);
  });
});

describe('session', () => {
  it('creates a session once with device info and persists the token', async () => {
    Platform.OS = 'android';
    Platform.Version = 34;
    configure();
    core.setContext({ screen: 'order_details', order_id: '1234' });
    const [a, b] = await Promise.all([core.ensureSession(), core.ensureSession()]);
    expect(a).toBe(b);
    expect(server.routes()).toEqual(['POST session']);
    const req = server.requests[0]!;
    expect(req.headers).toMatchObject({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-LB-App-Id': APP_ID,
      'X-LB-Platform': 'android',
      'X-LB-SDK': SDK_HEADER,
    });
    expect(req.headers['X-LB-Visitor']).toBeUndefined();
    expect(req.body).toEqual({
      locale: 'en',
      device: {
        platform: 'android',
        app_id: APP_ID,
        app_version: '2.3.0',
        sdk: 'react-native/0.1.0',
        os_version: '34',
      },
      ctx: { screen: 'order_details', order_id: '1234' },
    });
    expect(await storage.getItem(storageKey('visitor', APP_KEY))).toBe(a);
  });

  it('reuses a stored token without calling session', async () => {
    server.visitors.add('stored.token');
    await storage.setItem(storageKey('visitor', APP_KEY), 'stored.token');
    configure();
    expect(await core.ensureSession()).toBe('stored.token');
    await flush();
    expect(server.routes()).toEqual(['GET unread']); // background unread refresh on configure
  });

  it('replaces an invalid visitor token once and retries the request', async () => {
    configure();
    const revoked = await core.ensureSession();
    server.visitors.delete(revoked);
    server.requests.length = 0;
    await core.identify({ userId: 'u1', identityToken: JWT });
    expect(server.routes()).toEqual(['POST identify', 'POST session', 'POST identify']);
    const fresh = await storage.getItem(storageKey('visitor', APP_KEY));
    expect(fresh).not.toBe(revoked);
    expect(server.requests[2]!.headers['X-LB-Visitor']).toBe(fresh);
  });

  it('maps storage failures to storage_unavailable', async () => {
    configure({
      storage: {
        getItem: () => Promise.reject(new Error('locked')),
        setItem: () => Promise.reject(new Error('locked')),
        removeItem: () => Promise.reject(new Error('locked')),
      },
    });
    await expect(core.ensureSession()).rejects.toMatchObject({ code: 'storage_unavailable' });
  });
});

describe('errors', () => {
  it('maps uniform 404 to not_found', async () => {
    configure({ appKey: 'pk_unknown' });
    await expect(core.ensureSession()).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('maps app_not_registered', async () => {
    configure({ appId: 'com.other.app' });
    await expect(core.ensureSession()).rejects.toMatchObject({ code: 'app_not_registered', status: 403 });
  });

  it('exposes Retry-After on rate limits', async () => {
    server.use((req) =>
      req.route === 'POST identify'
        ? { status: 429, body: { error: 'slow_down' }, headers: { 'Retry-After': '30' } }
        : undefined
    );
    configure();
    await expect(core.identify({ userId: 'u', identityToken: JWT })).rejects.toMatchObject({
      code: 'slow_down',
      status: 429,
      retryAfter: 30,
    });
  });

  it('reports network and timeout failures', async () => {
    configure();
    server.offline = true;
    await expect(core.ensureSession()).rejects.toMatchObject({ code: 'network' });
    server.offline = false;
    server.hang = true;
    configure({ timeoutMs: 20 });
    await expect(core.ensureSession()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('emits errors to onError and on("error")', async () => {
    const onError = jest.fn();
    configure({ onError });
    const listener = jest.fn();
    core.on('error', listener);
    await expect(core.identify({ userId: 'u', identityToken: 'expired' })).rejects.toMatchObject({
      code: 'identity_expired',
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'identity_expired' }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toBeInstanceOf(LetsBotError);
  });
});

describe('identify / logout', () => {
  it('sends the identity token and profile fields', async () => {
    configure();
    await core.identify({ userId: 'u1', identityToken: JWT, name: 'Sara', email: 'sara@x.com', phone: '+9665' });
    const req = server.requests.find((r) => r.route === 'POST identify')!;
    expect(req.body).toEqual({ identity_token: JWT, name: 'Sara', email: 'sara@x.com', phone: '+9665' });
    expect(req.headers['X-LB-Visitor']).toBeTruthy();
  });

  it('rejects identity_invalid and missing arguments', async () => {
    configure();
    await expect(core.identify({ userId: 'u1', identityToken: 'nope' })).rejects.toMatchObject({
      code: 'identity_invalid',
    });
    await expect(core.identify({ userId: '', identityToken: JWT })).rejects.toMatchObject({
      code: 'invalid_argument',
    });
  });

  it('starts a fresh visitor when a different user identifies on the same device', async () => {
    configure();
    await core.identify({ userId: 'u1', identityToken: JWT });
    const first = await core.ensureSession();
    await core.identify({ userId: 'u1', identityToken: JWT });
    expect(await core.ensureSession()).toBe(first);
    await core.identify({ userId: 'u2', identityToken: JWT });
    const second = await core.ensureSession();
    expect(second).not.toBe(first);
    expect(server.routes()).toContain('POST logout');
  });

  it('logout calls the API, clears the token and resets unread', async () => {
    configure();
    const token = await core.ensureSession();
    server.unreadCount = 3;
    await core.refreshUnread();
    expect(core.getUnreadCount()).toBe(3);
    await core.logout();
    const logout = server.requests.find((r) => r.route === 'POST logout')!;
    expect(logout.headers['X-LB-Visitor']).toBe(token);
    expect(await storage.getItem(storageKey('visitor', APP_KEY))).toBeNull();
    expect(core.getUnreadCount()).toBe(0);
    // A new session is created lazily.
    const fresh = await core.ensureSession();
    expect(fresh).not.toBe(token);
  });

  it('logout succeeds offline and without a session', async () => {
    configure();
    await core.logout();
    expect(server.requests).toHaveLength(0);
    await core.ensureSession();
    server.offline = true;
    await expect(core.logout()).resolves.toBeUndefined();
  });
});

describe('push', () => {
  it('defers registration until a session exists, then registers once', async () => {
    configure();
    await core.setPushToken('fcm-token');
    expect(server.requests).toHaveLength(0);
    await core.ensureSession();
    await flush();
    const device = server.requests.find((r) => r.route === 'PUT device')!;
    expect(device.body).toEqual({
      provider: 'fcm',
      token: 'fcm-token',
      platform: 'ios',
      app_id: APP_ID,
      app_version: '2.3.0',
      sdk: 'react-native/0.1.0',
      locale: 'en',
      sandbox: false,
    });
    await core.setPushToken('fcm-token');
    expect(server.routes().filter((r) => r === 'PUT device')).toHaveLength(1);
  });

  it('registers immediately with an existing session and supports apns sandbox', async () => {
    configure();
    await core.ensureSession();
    await core.setPushToken('apns-hex', { provider: 'apns', sandbox: true });
    expect(server.devices.get('apns-hex')).toMatchObject({ provider: 'apns', sandbox: true });
  });

  it('re-registers after logout once a new session exists, and on locale change', async () => {
    configure();
    await core.ensureSession();
    await core.setPushToken('fcm-token');
    await core.logout();
    expect(server.devices.size).toBe(0);
    await core.ensureSession();
    await flush();
    expect(server.devices.has('fcm-token')).toBe(true);
    core.setLocale('ar');
    await flush();
    const puts = server.requests.filter((r) => r.route === 'PUT device');
    expect((puts[puts.length - 1]!.body as { locale: string }).locale).toBe('ar');
  });

  it('removePushToken deletes the device', async () => {
    configure();
    await core.ensureSession();
    await core.setPushToken('fcm-token');
    await core.removePushToken();
    expect(server.devices.size).toBe(0);
    expect(server.requests.find((r) => r.route === 'DELETE device')!.body).toEqual({ token: 'fcm-token' });
  });

  it('validates the provider', async () => {
    configure();
    await expect(core.setPushToken('t', { provider: 'gcm' as never })).rejects.toMatchObject({
      code: 'invalid_argument',
    });
  });
});

describe('unread', () => {
  it('is 0 without a session and does not create one', async () => {
    configure();
    expect(await core.refreshUnread()).toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it('notifies listeners, hook subscribers and onUnreadChanged', async () => {
    const onUnreadChanged = jest.fn();
    configure({ onUnreadChanged });
    await core.ensureSession();
    const listener = jest.fn();
    const sub = core.addUnreadListener(listener);
    expect(listener).toHaveBeenLastCalledWith(0);
    server.unreadCount = 2;
    expect(await core.refreshUnread()).toBe(2);
    expect(listener).toHaveBeenLastCalledWith(2);
    expect(onUnreadChanged).toHaveBeenCalledWith(2);
    expect(core.getUnreadState().last).toEqual({ t: 'Your order shipped', at: '2026-10-08T12:00:00+03:00' });
    sub.remove();
    server.unreadCount = 5;
    await core.refreshUnread();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('refreshes when the app becomes active', async () => {
    configure();
    await core.ensureSession();
    server.unreadCount = 4;
    __mock.setAppState('background');
    __mock.setAppState('active');
    await flush();
    expect(core.getUnreadCount()).toBe(4);
  });

  it('is 0 while the chat is visible and refreshes on close', async () => {
    const onOpen = jest.fn();
    const onClose = jest.fn();
    configure({ onOpen, onClose });
    await core.ensureSession();
    server.unreadCount = 2;
    await core.refreshUnread();
    const detach = core.attachView({ inject: jest.fn() });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(core.getUnreadCount()).toBe(0);
    expect(await core.refreshUnread()).toBe(0);
    core.setUnreadFromPage(0);
    server.unreadCount = 1;
    detach();
    expect(onClose).toHaveBeenCalledTimes(1);
    await flush();
    expect(core.getUnreadCount()).toBe(1);
  });

  it('drops the token silently when unread says invalid_visitor', async () => {
    await storage.setItem(storageKey('visitor', APP_KEY), 'gone.token');
    configure();
    await flush();
    expect(core.getUnreadCount()).toBe(0);
    expect(await storage.getItem(storageKey('visitor', APP_KEY))).toBeNull();
  });
});

describe('presentation, notifications and bridge state', () => {
  it('show() waits for a provider (cold start from a notification)', () => {
    configure();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(core.handleNotification({ data: { lb: '1', lb_k: APP_KEY, lb_c: '9' } })).toBe(true);
    const presenter = { show: jest.fn(), hide: jest.fn() };
    const unregister = core.registerPresenter(presenter);
    expect(presenter.show).toHaveBeenCalledTimes(1);
    core.hide();
    expect(presenter.hide).toHaveBeenCalledTimes(1);
    unregister();
    warn.mockRestore();
  });

  it('ignores other notifications and other apps', () => {
    configure();
    const presenter = { show: jest.fn(), hide: jest.fn() };
    core.registerPresenter(presenter);
    expect(core.handleNotification({ title: 'Sale' })).toBe(false);
    expect(core.handleNotification({ lb: '1', lb_k: 'pk_other' })).toBe(false);
    expect(presenter.show).not.toHaveBeenCalled();
    expect(core.handleNotification({ lb: '1' })).toBe(true);
    expect(presenter.show).toHaveBeenCalledTimes(1);
  });

  it('pushes context and theme changes into open chat views', () => {
    configure();
    const inject = jest.fn();
    core.attachView({ inject });
    core.setContext({ screen: 'cart' });
    expect(inject).toHaveBeenLastCalledWith(expect.stringContaining('setContext({"screen":"cart"})'));
    core.setTheme('dark');
    expect(inject).toHaveBeenLastCalledWith(expect.stringContaining('setTheme("dark")'));
    core.setTheme('auto');
    __mock.setColorScheme('dark');
    expect(inject).toHaveBeenLastCalledWith(expect.stringContaining('setTheme("dark")'));
  });

  it('builds the boot payload with context and colour', async () => {
    configure({ color: '#112233' });
    core.setContext({ screen: 'home' });
    expect(core.bootPayload('tok')).toEqual({
      token: 'tok',
      appId: APP_ID,
      platform: 'ios',
      sdk: 'react-native/0.1.0',
      context: { screen: 'home' },
      color: '#112233',
    });
  });

  it('notifies locale listeners and normalises the locale', () => {
    configure();
    const listener = jest.fn();
    core.onLocaleChange(listener);
    core.setLocale('pt_BR');
    expect(listener).toHaveBeenCalledWith('pt');
    expect(core.uiUrl()).toContain('l=pt');
    core.setLocale('pt');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits incoming messages to onMessage', () => {
    const onMessage = jest.fn();
    configure({ onMessage });
    core.emitMessage('Hello');
    expect(onMessage).toHaveBeenCalledWith({ text: 'Hello' });
  });
});
