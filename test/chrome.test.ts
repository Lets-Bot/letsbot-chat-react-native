import { buildHostCall, parseBridgeMessage } from '../src/bridge';
import {
  insetsPayload,
  isDarkColor,
  mergeChrome,
  neutralChrome,
  normalizeHex,
  overlapInsets,
  sameChrome,
  sameInsets,
} from '../src/chrome';

describe('chrome event', () => {
  it('parses the status-bar style and colours', () => {
    expect(
      parseBridgeMessage('{"lb":"chrome","statusBar":"light","header":"#0E7C66","background":"#f5f7f9"}')
    ).toEqual({ lb: 'chrome', lightStatusBar: true, header: '#0e7c66', background: '#f5f7f9' });
    expect(parseBridgeMessage('{"lb":"chrome","statusBar":"dark"}')).toEqual({ lb: 'chrome', lightStatusBar: false });
  });

  it('rejects malformed chrome events', () => {
    for (const raw of [
      '{"lb":"chrome"}',
      '{"lb":"chrome","statusBar":"white"}',
      '{"lb":"chrome","statusBar":"light","header":"green"}',
      '{"lb":"chrome","statusBar":"light","header":"#0e7c6"}',
      '{"lb":"chrome","statusBar":"dark","background":"#fff"}',
      '{"lb":"chrome","statusBar":"dark","background":12}',
    ]) {
      expect(parseBridgeMessage(raw)).toBeNull();
    }
  });
});

describe('chrome colours', () => {
  it('normalises and classifies colours', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('abcdef')).toBeNull();
    expect(normalizeHex(12)).toBeNull();
    expect(isDarkColor('#0e7c66')).toBe(true);
    expect(isDarkColor('#f5f7f9')).toBe(false);
    expect(isDarkColor('nope')).toBe(false);
  });

  it('neutral chrome uses the brand colour for the header', () => {
    expect(neutralChrome(false, '#0E7C66')).toEqual({ lightStatusBar: true, header: '#0e7c66', background: '#ffffff' });
    expect(neutralChrome(false).lightStatusBar).toBe(false);
    expect(neutralChrome(true)).toEqual({ lightStatusBar: true, header: '#111418', background: '#111418' });
  });

  it('merges a chrome event over the current colours', () => {
    const base = { lightStatusBar: true, header: '#0e7c66', background: '#ffffff' };
    const merged = mergeChrome(base, { lightStatusBar: false, background: '#000000' });
    expect(merged).toEqual({ lightStatusBar: false, header: '#0e7c66', background: '#000000' });
    expect(sameChrome(base, { ...base })).toBe(true);
    expect(sameChrome(base, merged)).toBe(false);
  });
});

describe('insets', () => {
  it('serialise as CSS px for boot / setInsets', () => {
    expect(insetsPayload({ top: 47.333333, bottom: 34, left: -1 })).toEqual({ top: 47.33, bottom: 34, left: 0, right: 0 });
    expect(insetsPayload(null)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(sameInsets(insetsPayload({ top: 1 }), insetsPayload({ top: 1 }))).toBe(true);
    expect(buildHostCall('setInsets', insetsPayload({ top: 20 }))).toContain(
      'h.setInsets({"top":20,"bottom":0,"left":0,"right":0})'
    );
  });

  it('full-screen view gets the whole safe area', () => {
    expect(overlapInsets({ top: 59, bottom: 34 }, 390, 844)).toEqual({ top: 59, bottom: 34, left: 0, right: 0 });
  });

  it('a view below an app bar / above a tab bar only gets what overlaps it', () => {
    const frame = { x: 0, y: 103, width: 390, height: 658 };
    expect(overlapInsets({ top: 59, bottom: 34 }, 390, 844, frame)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    const toBottom = { x: 0, y: 103, width: 390, height: 741 };
    expect(overlapInsets({ top: 59, bottom: 34 }, 390, 844, toBottom).bottom).toBe(34);
  });

  it('the keyboard counts in the bottom inset (larger of keyboard and navigation bar)', () => {
    expect(overlapInsets({ top: 24, bottom: 48 }, 412, 915, null, 600)).toEqual({
      top: 24,
      bottom: 315,
      left: 0,
      right: 0,
    });
    // Window already resized above the keyboard: no overlap, no double counting.
    expect(overlapInsets({ top: 24, bottom: 0 }, 412, 600, { x: 0, y: 0, width: 412, height: 600 }, 600).bottom).toBe(0);
    // Landscape cutout / bars on the sides.
    expect(overlapInsets({ left: 47, right: 47 }, 844, 390)).toEqual({ top: 0, bottom: 0, left: 47, right: 47 });
  });
});
