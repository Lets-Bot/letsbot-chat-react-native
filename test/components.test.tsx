import { act, createElement } from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import { create } from 'react-test-renderer';

import { LetsBot, LetsBotChatView, LetsBotProvider, useLetsBotUnread } from '../src';
import { core } from '../src/instance';
import { createMemoryStorageAdapter } from '../src/storage';
import { APP_ID, APP_KEY, MockLetsBotServer, flush } from './helpers/mockServer';
import { Linking } from './mocks/react-native';

const mockInjectJavaScript = jest.fn();
const mockReload = jest.fn();
const injectJavaScript = mockInjectJavaScript;

jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const React = jest.requireActual<typeof import('react')>('react');
  const WebView = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInjectJavaScript, reload: mockReload }));
    return React.createElement('WebView', props);
  });
  return { WebView };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UI = `https://letsbot.net/api/sdk/v1/${APP_KEY}/ui?l=en&theme=auto&p=ios`;

let server: MockLetsBotServer;

beforeEach(() => {
  server = new MockLetsBotServer();
  server.install();
  injectJavaScript.mockClear();
  (Linking.openURL as jest.Mock).mockClear();
});

afterEach(() => core.reset());

function configure() {
  LetsBot.configure({ appKey: APP_KEY, appId: APP_ID, locale: 'en', storage: createMemoryStorageAdapter() });
}

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  await act(async () => {
    await flush();
  });
  return renderer;
}

function webView(renderer: ReactTestRenderer) {
  return renderer.root.findByType('WebView' as never);
}

function post(renderer: ReactTestRenderer, data: unknown, url = UI) {
  act(() => {
    webView(renderer).props.onMessage({ nativeEvent: { url, data: JSON.stringify(data) } });
  });
}

describe('<LetsBotChatView>', () => {
  it('shows an error state when not configured', async () => {
    const onError = jest.fn();
    LetsBot.on('error', onError);
    const renderer = await render(createElement(LetsBotChatView));
    expect(renderer.root.findAllByType('WebView' as never)).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_configured' }));
  });

  it('loads the ui URL in a locked-down WebView and boots on ready', async () => {
    configure();
    const onClose = jest.fn();
    const renderer = await render(createElement(LetsBotChatView, { onClose }));
    const props = webView(renderer).props;
    expect(server.routes()).toEqual(['POST session']);
    expect(props.source.uri).toBe(UI);
    expect(props.source.headers).toMatchObject({ 'X-LB-App-Id': APP_ID, 'X-LB-SDK': 'react-native/0.1.0' });
    expect(props.originWhitelist).toEqual(['*']);
    expect(props.mediaCapturePermissionGrantType).toBe('grantIfSameHostElsePrompt');
    expect(props.allowsInlineMediaPlayback).toBe(true);
    expect(props.allowFileAccess).toBe(false);
    expect(props.setSupportMultipleWindows).toBe(false);

    post(renderer, { lb: 'ready' });
    const token = await core.ensureSession();
    expect(injectJavaScript).toHaveBeenCalledTimes(1);
    expect(injectJavaScript.mock.calls[0][0]).toContain(`h.boot({"token":"${token}","appId":"${APP_ID}"`);

    post(renderer, { lb: 'close' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores messages from other origins', async () => {
    configure();
    const renderer = await render(createElement(LetsBotChatView));
    post(renderer, { lb: 'ready' }, 'https://evil.example.com/');
    post(renderer, { lb: 'open_url', url: 'https://phish.example.com' }, 'https://evil.example.com/');
    expect(injectJavaScript).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('opens links externally (http/https only) and keeps the WebView on the ui URL', async () => {
    configure();
    const renderer = await render(createElement(LetsBotChatView));
    const decide = webView(renderer).props.onShouldStartLoadWithRequest;
    expect(decide({ url: UI, isTopFrame: true })).toBe(true);
    expect(decide({ url: 'https://shop.example.com/p/1', isTopFrame: true })).toBe(false);
    expect(Linking.openURL).toHaveBeenCalledWith('https://shop.example.com/p/1');
    expect(decide({ url: 'tel:+15550000', isTopFrame: true })).toBe(false);
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    post(renderer, { lb: 'open_url', url: 'https://letsbot.net/terms' });
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://letsbot.net/terms');
  });

  it('renews the session on token_invalid, relays unread / message / error', async () => {
    configure();
    const onMessage = jest.fn();
    const onError = jest.fn();
    LetsBot.on('message', onMessage);
    LetsBot.on('error', onError);
    const renderer = await render(createElement(LetsBotChatView));
    const first = await core.ensureSession();
    post(renderer, { lb: 'token_invalid' });
    await act(async () => {
      await flush();
    });
    const second = await core.ensureSession();
    expect(second).not.toBe(first);
    expect(injectJavaScript.mock.calls.at(-1)?.[0]).toContain(second);

    post(renderer, { lb: 'unread', count: 0 });
    expect(LetsBot.unreadCount).toBe(0);
    post(renderer, { lb: 'message', t: 'Your order shipped' });
    expect(onMessage).toHaveBeenCalledWith({ text: 'Your order shipped' });
    post(renderer, { lb: 'error', code: 'blocked' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'blocked' }));
  });

  it('emits open / close and pushes context into the page', async () => {
    configure();
    const onOpen = jest.fn();
    const onClose = jest.fn();
    LetsBot.on('open', onOpen);
    LetsBot.on('close', onClose);
    const renderer = await render(createElement(LetsBotChatView));
    expect(onOpen).toHaveBeenCalledTimes(1);
    LetsBot.setContext({ screen: 'checkout' });
    expect(injectJavaScript.mock.calls.at(-1)?.[0]).toContain('setContext({"screen":"checkout"})');
    await act(async () => {
      renderer.unmount();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<LetsBotProvider> and useLetsBotUnread', () => {
  it('opens and closes the modal through LetsBot.show() / hide() and notifications', async () => {
    configure();
    const renderer = await render(createElement(LetsBotProvider, null, createElement('App')));
    const modal = () => renderer.root.findByType('Modal' as never);
    expect(modal().props.visible).toBe(false);
    await act(async () => {
      LetsBot.show();
      await flush();
    });
    expect(modal().props.visible).toBe(true);
    expect(renderer.root.findAllByType('WebView' as never)).toHaveLength(1);
    await act(async () => {
      modal().props.onRequestClose();
    });
    expect(modal().props.visible).toBe(false);
    await act(async () => {
      expect(LetsBot.handleNotification({ data: { lb: '1', lb_k: APP_KEY } })).toBe(true);
    });
    expect(modal().props.visible).toBe(true);
    await act(async () => {
      LetsBot.hide();
    });
    expect(modal().props.visible).toBe(false);
  });

  it('re-renders the unread badge', async () => {
    configure();
    await core.ensureSession();
    const seen: number[] = [];
    function Badge() {
      const count = useLetsBotUnread();
      seen.push(count);
      return createElement('Text', null, String(count));
    }
    await render(createElement(Badge));
    server.unreadCount = 3;
    await act(async () => {
      await LetsBot.refreshUnread();
    });
    expect(seen.at(-1)).toBe(3);
  });
});
