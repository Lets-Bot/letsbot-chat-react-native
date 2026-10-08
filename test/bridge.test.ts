import {
  buildHostCall,
  decideNavigation,
  isHttpUrl,
  isTrustedSource,
  normalizeBaseUrl,
  parseBridgeMessage,
  parseUrl,
  toJsLiteral,
} from '../src/bridge';

const UI = 'https://letsbot.net/api/sdk/v1/pk_test/ui?l=en&theme=auto&p=ios';

describe('parseUrl', () => {
  it('parses origins and paths', () => {
    expect(parseUrl('HTTPS://LetsBot.net:443/a/b?x=1#y')).toEqual({
      scheme: 'https',
      origin: 'https://letsbot.net',
      path: '/a/b',
    });
    expect(parseUrl('http://localhost:8000')).toEqual({
      scheme: 'http',
      origin: 'http://localhost:8000',
      path: '/',
    });
  });

  it('rejects userinfo tricks and non-hierarchical URLs', () => {
    expect(parseUrl('https://letsbot.net@evil.com/')).toBeNull();
    expect(parseUrl('mailto:a@b.c')).toBeNull();
    expect(parseUrl('javascript:alert(1)')).toBeNull();
    expect(parseUrl('')).toBeNull();
  });

  it('isHttpUrl / normalizeBaseUrl', () => {
    expect(isHttpUrl('https://x.com/a')).toBe(true);
    expect(isHttpUrl('tel:+1')).toBe(false);
    expect(normalizeBaseUrl('https://letsbot.net///')).toBe('https://letsbot.net');
    expect(normalizeBaseUrl('file:///etc')).toBeNull();
  });
});

describe('decideNavigation', () => {
  it('allows only the ui URL in the main frame', () => {
    expect(decideNavigation({ url: UI }, UI)).toBe('allow');
    expect(decideNavigation({ url: `${UI}#bottom`, isTopFrame: true }, UI)).toBe('allow');
    expect(decideNavigation({ url: 'https://letsbot.net/api/sdk/v1/pk_test/ui?l=ar' }, UI)).toBe('allow');
    expect(decideNavigation({ url: 'about:blank' }, UI)).toBe('allow');
  });

  it('sends other http(s) URLs to the system browser', () => {
    expect(decideNavigation({ url: 'https://letsbot.net/pricing' }, UI)).toBe('external');
    expect(decideNavigation({ url: 'https://shop.example.com/p/1' }, UI)).toBe('external');
    expect(decideNavigation({ url: 'http://letsbot.net.evil.com/api/sdk/v1/pk_test/ui' }, UI)).toBe('external');
  });

  it('blocks non-http schemes', () => {
    for (const url of ['tel:+1555', 'mailto:a@b.c', 'intent://x#Intent;end', 'javascript:alert(1)', 'file:///etc/hosts', 'myapp://deep']) {
      expect(decideNavigation({ url }, UI)).toBe('block');
    }
  });

  it('allows same-origin sub-frames only', () => {
    expect(decideNavigation({ url: 'https://letsbot.net/embed/x', isTopFrame: false }, UI)).toBe('allow');
    expect(decideNavigation({ url: 'https://ads.example.com/', isTopFrame: false }, UI)).toBe('block');
  });
});

describe('isTrustedSource', () => {
  it('accepts only the LetsBot origin', () => {
    expect(isTrustedSource(UI, 'https://letsbot.net')).toBe(true);
    expect(isTrustedSource('https://evil.com/x', 'https://letsbot.net')).toBe(false);
    expect(isTrustedSource('http://letsbot.net/x', 'https://letsbot.net')).toBe(false);
    expect(isTrustedSource(undefined, 'https://letsbot.net')).toBe(false);
  });
});

describe('parseBridgeMessage', () => {
  it('parses every event of API.md §5', () => {
    expect(parseBridgeMessage('{"lb":"ready"}')).toEqual({ lb: 'ready' });
    expect(parseBridgeMessage('{"lb":"token_invalid"}')).toEqual({ lb: 'token_invalid' });
    expect(parseBridgeMessage('{"lb":"close"}')).toEqual({ lb: 'close' });
    expect(parseBridgeMessage('{"lb":"open_url","url":"https://x.com"}')).toEqual({
      lb: 'open_url',
      url: 'https://x.com',
    });
    expect(parseBridgeMessage('{"lb":"unread","count":3}')).toEqual({ lb: 'unread', count: 3 });
    expect(parseBridgeMessage('{"lb":"message","t":"Hi"}')).toEqual({ lb: 'message', t: 'Hi' });
    expect(parseBridgeMessage('{"lb":"error","code":"blocked"}')).toEqual({ lb: 'error', code: 'blocked' });
  });

  it('rejects malformed or unsafe messages', () => {
    expect(parseBridgeMessage('not json')).toBeNull();
    expect(parseBridgeMessage('{"lb":"open_url","url":"javascript:alert(1)"}')).toBeNull();
    expect(parseBridgeMessage('{"lb":"unread","count":-1}')).toBeNull();
    expect(parseBridgeMessage('{"lb":"unread","count":1.5}')).toBeNull();
    expect(parseBridgeMessage('{"lb":"message"}')).toBeNull();
    expect(parseBridgeMessage('{"lb":"eval","code":"x"}')).toBeNull();
    expect(parseBridgeMessage(42)).toBeNull();
    expect(parseBridgeMessage('null')).toBeNull();
  });
});

describe('host calls', () => {
  it('escapes values for injected scripts', () => {
    expect(toJsLiteral({ a: '</script>\u2028' })).toBe('{"a":"\\u003c/script>\\u2028"}');
  });

  it('builds guarded LetsBotHost calls', () => {
    const script = buildHostCall('boot', { token: 't' });
    expect(script).toContain("typeof h.boot==='function'");
    expect(script).toContain('h.boot({"token":"t"})');
    expect(script.endsWith('true;')).toBe(true);
    // The script is valid JavaScript and calls the host.
    const boot = jest.fn();
    new Function('window', script)({ LetsBotHost: { boot } });
    expect(boot).toHaveBeenCalledWith({ token: 't' });
    expect(() => new Function('window', script)({})).not.toThrow();
  });
});
