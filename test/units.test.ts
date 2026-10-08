import { appInfoFromDeviceInfo, appInfoFromExpoApplication } from '../src/appInfo';
import { Emitter } from '../src/emitter';
import { LetsBotError, asLetsBotError, isLetsBotError, toErrorCode } from '../src/errors';
import { ApiClient, parseRetryAfter } from '../src/http';
import { isLetsBotNotification, notificationAppKey } from '../src/notifications';
import {
  createDefaultStorageAdapter,
  createExpoSecureStoreAdapter,
  createKeychainAdapter,
  storageKey,
} from '../src/storage';
import { SDK_HEADER, SDK_VERSION } from '../src/version';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json') as { version: string; name: string };

describe('version', () => {
  it('matches package.json', () => {
    expect(SDK_VERSION).toBe(pkg.version);
    expect(SDK_HEADER).toBe(`react-native/${pkg.version}`);
  });
});

describe('notifications', () => {
  it('detects LetsBot payloads (data map or wrapper)', () => {
    expect(isLetsBotNotification({ lb: '1', lb_k: 'k', lb_c: '5' })).toBe(true);
    expect(isLetsBotNotification({ data: { lb: '1' } })).toBe(true);
    expect(isLetsBotNotification({ lb: 1 })).toBe(true);
    expect(isLetsBotNotification({ lb: '0' })).toBe(false);
    expect(isLetsBotNotification({ title: 'x' })).toBe(false);
    expect(isLetsBotNotification(null)).toBe(false);
    expect(isLetsBotNotification('lb')).toBe(false);
    expect(notificationAppKey({ data: { lb: '1', lb_k: 'pk' } })).toBe('pk');
    expect(notificationAppKey({ lb: '1' })).toBeNull();
  });
});

describe('errors', () => {
  it('maps codes and keeps metadata', () => {
    expect(toErrorCode('identity_expired')).toBe('identity_expired');
    expect(toErrorCode('something_new')).toBe('unknown');
    const error = new LetsBotError('busy', { status: 429, retryAfter: 5 });
    expect(error).toBeInstanceOf(Error);
    expect(isLetsBotError(error)).toBe(true);
    expect(error.name).toBe('LetsBotError');
    expect(error.message).toMatch(/busy/);
    expect(asLetsBotError(new Error('x')).code).toBe('unknown');
    expect(asLetsBotError(error)).toBe(error);
  });
});

describe('http', () => {
  it('parses Retry-After', () => {
    expect(parseRetryAfter('12')).toBe(12);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('Wed, 08 Oct 2026 12:00:30 GMT', Date.parse('Wed, 08 Oct 2026 12:00:00 GMT'))).toBe(30);
    expect(parseRetryAfter('soon')).toBeUndefined();
  });

  it('encodes the app key, omits cookies and maps empty error bodies by status', async () => {
    const fetchImpl = jest.fn(async () => new Response('<html>', { status: 404 }));
    const client = new ApiClient({
      baseUrl: 'https://letsbot.net',
      appKey: 'a/b',
      appId: 'com.acme',
      platform: 'android',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.request('GET', 'unread', { visitor: 'v' })).rejects.toMatchObject({ code: 'not_found' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://letsbot.net/api/sdk/v1/a%2Fb/unread');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toMatchObject({ 'X-LB-Visitor': 'v', 'X-LB-Platform': 'android' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

describe('emitter', () => {
  it('isolates listener failures and supports both unsubscribe styles', () => {
    const emitter = new Emitter();
    const good = jest.fn();
    emitter.on('unreadChanged', () => {
      throw new Error('bad listener');
    });
    const sub = emitter.on('unreadChanged', good);
    emitter.emit('unreadChanged', 1);
    expect(good).toHaveBeenCalledWith(1);
    sub();
    sub.remove();
    emitter.emit('unreadChanged', 2);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('storage adapters', () => {
  it('keychain adapter uses one service per key', async () => {
    const store = new Map<string, string>();
    const keychain = {
      ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly' },
      getGenericPassword: jest.fn(async (o?: { service?: string }) =>
        store.has(o!.service!) ? { password: store.get(o!.service!)! } : (false as const)
      ),
      setGenericPassword: jest.fn(async (_u: string, p: string, o?: { service?: string }) => {
        store.set(o!.service!, p);
        return true;
      }),
      resetGenericPassword: jest.fn(async (o?: { service?: string }) => store.delete(o!.service!)),
    };
    const adapter = createKeychainAdapter(keychain);
    expect(await adapter.getItem('k')).toBeNull();
    await adapter.setItem('k', 'v');
    expect(keychain.setGenericPassword).toHaveBeenCalledWith('letsbot', 'v', {
      service: 'net.letsbot.chat.k',
      accessible: 'AccessibleAfterFirstUnlockThisDeviceOnly',
    });
    expect(await adapter.getItem('k')).toBe('v');
    await adapter.removeItem('k');
    expect(await adapter.getItem('k')).toBeNull();
  });

  it('expo-secure-store adapter', async () => {
    const store = new Map<string, string>();
    const secureStore = {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
      getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
      setItemAsync: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      deleteItemAsync: jest.fn(async (k: string) => {
        store.delete(k);
      }),
    };
    const adapter = createExpoSecureStoreAdapter(secureStore);
    await adapter.setItem('a', 'b');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('a', 'b', { keychainAccessible: 1 });
    expect(await adapter.getItem('a')).toBe('b');
    await adapter.removeItem('a');
    expect(await adapter.getItem('a')).toBeNull();
  });

  it('default adapter resolves react-native-keychain lazily', async () => {
    jest.resetModules();
    jest.doMock('react-native-keychain', () => {
      throw new Error('Cannot find module');
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
    const { createDefaultStorageAdapter: create } = require('../src/storage') as typeof import('../src/storage');
    await expect(create().getItem('x')).rejects.toMatchObject({ code: 'storage_unavailable' });
    jest.dontMock('react-native-keychain');
    expect(typeof createDefaultStorageAdapter).toBe('function');
  });

  it('builds storage-safe keys', () => {
    expect(storageKey('visitor', 'pk_live/AB+c')).toBe('letsbot.visitor.pk_live_AB_c');
  });
});

describe('app info helpers', () => {
  it('reads react-native-device-info and expo-application', () => {
    expect(appInfoFromDeviceInfo({ getBundleId: () => 'com.acme', getVersion: () => '1.2.3' })).toEqual({
      appId: 'com.acme',
      appVersion: '1.2.3',
    });
    expect(appInfoFromExpoApplication({ applicationId: 'com.acme', nativeApplicationVersion: null })).toEqual({
      appId: 'com.acme',
      appVersion: undefined,
    });
  });
});
