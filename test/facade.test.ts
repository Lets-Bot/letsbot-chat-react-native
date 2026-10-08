import { LetsBot, LetsBotError, isLetsBotNotification } from '../src';
import { core } from '../src/instance';
import { createMemoryStorageAdapter } from '../src/storage';
import { APP_ID, APP_KEY, MockLetsBotServer } from './helpers/mockServer';

jest.mock('react-native-webview', () => ({ WebView: () => null }), { virtual: false });

describe('LetsBot facade', () => {
  let server: MockLetsBotServer;

  beforeEach(() => {
    server = new MockLetsBotServer();
    server.install();
  });

  afterEach(() => core.reset());

  it('exposes the public API from INSTALL_PROMPT.md', () => {
    for (const name of [
      'configure',
      'identify',
      'logout',
      'show',
      'hide',
      'setPushToken',
      'isLetsBotNotification',
      'handleNotification',
      'addUnreadListener',
      'setContext',
      'setLocale',
      'setTheme',
      'on',
    ] as const) {
      expect(typeof LetsBot[name]).toBe('function');
    }
    expect(LetsBot.version).toBe('0.1.0');
    expect(isLetsBotNotification({ lb: '1' })).toBe(true);
  });

  it('runs an end-to-end flow against the mock API', async () => {
    LetsBot.configure({ appKey: APP_KEY, appId: APP_ID, storage: createMemoryStorageAdapter(), locale: 'en' });
    const counts: number[] = [];
    const unsubscribe = LetsBot.addUnreadListener((count) => counts.push(count));
    await LetsBot.identify({ userId: 'u1', identityToken: 'a.b.c', name: 'Sara' });
    await LetsBot.setPushToken('fcm-token');
    server.unreadCount = 2;
    await LetsBot.refreshUnread();
    expect(LetsBot.unreadCount).toBe(2);
    expect(counts).toEqual([0, 2]);
    unsubscribe();
    await LetsBot.logout();
    expect(LetsBot.unreadCount).toBe(0);
    expect(server.routes()).toEqual([
      'POST session',
      'POST identify',
      'PUT device',
      'GET unread',
      'POST logout',
    ]);
    await expect(LetsBot.identify({ userId: 'u1', identityToken: 'bad' })).rejects.toBeInstanceOf(LetsBotError);
  });
});
