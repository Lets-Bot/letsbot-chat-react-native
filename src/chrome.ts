/**
 * Pure helpers for the edge-to-edge chat screen (API.md §8.1): chrome colours reported by the page and the
 * safe-area insets passed to it. No React Native imports so they are unit-testable.
 */

/** Colours of the hosted page's chrome. */
export interface ChatChrome {
  /** `true` = light (white) status-bar icons (dark header). */
  lightStatusBar: boolean;
  /** Header colour, `#rrggbb` lower case. */
  header: string;
  /** Page background, `#rrggbb` lower case. */
  background: string;
}

/** Payload of the page's `{"lb":"chrome", ...}` event (colours are optional). */
export interface ChromeEvent {
  lightStatusBar: boolean;
  header?: string;
  background?: string;
}

/** Safe-area insets in CSS px (= React Native dp). */
export interface ChatInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const ZERO_INSETS: ChatInsets = Object.freeze({ top: 0, bottom: 0, left: 0, right: 0 });

export const LIGHT_BACKGROUND = '#ffffff';
export const DARK_BACKGROUND = '#111418';

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** `#RRGGBB` / `#rrggbb` → lower case; null for anything else. */
export function normalizeHex(value: unknown): string | null {
  return typeof value === 'string' && HEX_RE.test(value) ? value.toLowerCase() : null;
}

/** WCAG relative luminance < 0.5 → needs light content on top. */
export function isDarkColor(hex: string): boolean {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return false;
  }
  const value = parseInt(normalized.slice(1), 16);
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * linear((value >> 16) & 0xff) + 0.7152 * linear((value >> 8) & 0xff) + 0.0722 * linear(value & 0xff);
  return luminance < 0.5;
}

/**
 * Chrome used before the page reports its own (and nothing is cached): the app's brand colour as header when set,
 * otherwise the plain light / dark background.
 */
export function neutralChrome(dark: boolean, brandColor?: string | null): ChatChrome {
  const background = dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  const header = normalizeHex(brandColor) ?? background;
  return { lightStatusBar: isDarkColor(header), header, background };
}

/** Applies a `chrome` event; colours it omits keep their current value. */
export function mergeChrome(current: ChatChrome, event: ChromeEvent): ChatChrome {
  return {
    lightStatusBar: event.lightStatusBar,
    header: event.header ?? current.header,
    background: event.background ?? current.background,
  };
}

export function sameChrome(a: ChatChrome | null | undefined, b: ChatChrome | null | undefined): boolean {
  return !!a && !!b && a.lightStatusBar === b.lightStatusBar && a.header === b.header && a.background === b.background;
}

/** Rounds to 2 decimals; negative / non-finite → 0. */
function clean(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
}

/** Normalises insets for `boot({insets})` / `LetsBotHost.setInsets(...)`. */
export function insetsPayload(insets: Partial<ChatInsets> | null | undefined): ChatInsets {
  return {
    top: clean(insets?.top ?? 0),
    bottom: clean(insets?.bottom ?? 0),
    left: clean(insets?.left ?? 0),
    right: clean(insets?.right ?? 0),
  };
}

export function sameInsets(a: ChatInsets | null | undefined, b: ChatInsets | null | undefined): boolean {
  return !!a && !!b && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

/** Position and size of the chat view in window coordinates. */
export interface ViewFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How much of the window's safe-area [windowInsets] (status bar, notch, home indicator / navigation bar) and of the
 * keyboard overlaps a view at [frame] in a window of [windowWidth] × [windowHeight]. Without a frame the view is
 * assumed to fill the window. [keyboardTop] is the keyboard's top edge in window coordinates (null = hidden); the
 * bottom inset is the larger of the safe area and the keyboard so the composer stays above both.
 */
export function overlapInsets(
  windowInsets: Partial<ChatInsets> | null | undefined,
  windowWidth: number,
  windowHeight: number,
  frame?: ViewFrame | null,
  keyboardTop?: number | null
): ChatInsets {
  const view: ViewFrame =
    frame && frame.width > 0 && frame.height > 0 ? frame : { x: 0, y: 0, width: windowWidth, height: windowHeight };
  const safe = insetsPayload(windowInsets);
  const viewBottom = view.y + view.height;
  const viewRight = view.x + view.width;
  const fromBottom = Math.max(0, windowHeight - viewBottom);
  const keyboard = typeof keyboardTop === 'number' && Number.isFinite(keyboardTop) ? Math.max(0, viewBottom - keyboardTop) : 0;
  return insetsPayload({
    top: safe.top - view.y,
    bottom: Math.max(safe.bottom - fromBottom, keyboard),
    left: safe.left - view.x,
    right: safe.right - Math.max(0, windowWidth - viewRight),
  });
}
