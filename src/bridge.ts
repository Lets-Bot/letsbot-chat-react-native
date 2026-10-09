/**
 * Pure helpers for the hosted UI ⇄ native bridge (API.md §5). No React Native imports so they are unit-testable.
 */

import { normalizeHex } from './chrome';
import type { ChatInsets } from './chrome';

export interface ParsedUrl {
  scheme: string;
  /** `scheme://host[:port]`, lower-cased, default port removed. */
  origin: string;
  /** Path without query / fragment (at least `/`). */
  path: string;
}

const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;

/** Minimal URL parser (React Native's `URL` polyfill lacks most getters). Returns null for non-hierarchical URLs. */
export function parseUrl(url: string): ParsedUrl | null {
  if (typeof url !== 'string') {
    return null;
  }
  const match = URL_RE.exec(url.trim());
  if (!match) {
    return null;
  }
  const scheme = match[1]!.toLowerCase();
  let authority = match[2]!.toLowerCase();
  if (authority === '' || authority.includes('@') || authority.includes('\\')) {
    return null;
  }
  if (
    (scheme === 'https' && authority.endsWith(':443')) ||
    (scheme === 'http' && authority.endsWith(':80'))
  ) {
    authority = authority.slice(0, authority.lastIndexOf(':'));
  }
  return { scheme, origin: `${scheme}://${authority}`, path: match[3] || '/' };
}

/** True for absolute http(s) URLs. */
export function isHttpUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && (parsed.scheme === 'http' || parsed.scheme === 'https');
}

/** Normalises a base URL: no trailing slash; must be http(s). */
export function normalizeBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const parsed = parseUrl(trimmed);
  if (!parsed || (parsed.scheme !== 'https' && parsed.scheme !== 'http')) {
    return null;
  }
  return trimmed;
}

export type NavigationDecision = 'allow' | 'external' | 'block';

export interface NavigationRequest {
  url: string;
  /** iOS / Android report whether the request targets the main frame. Undefined = main frame. */
  isTopFrame?: boolean;
}

/**
 * Decides what to do with a WebView navigation: only the hosted `ui` URL may load in the main frame; any other
 * http(s) URL opens in the system browser; everything else (tel:, intent:, javascript:, file:, …) is blocked.
 * Sub-frames may load same-origin documents only.
 */
export function decideNavigation(
  request: NavigationRequest,
  uiUrl: string
): NavigationDecision {
  const { url } = request;
  if (url === 'about:blank' || url === 'about:srcdoc') {
    return 'allow';
  }
  const target = parseUrl(url);
  const ui = parseUrl(uiUrl);
  if (!target || !ui) {
    return 'block';
  }
  const isHttp = target.scheme === 'http' || target.scheme === 'https';
  if (request.isTopFrame === false) {
    return target.origin === ui.origin ? 'allow' : 'block';
  }
  if (target.origin === ui.origin && target.path === ui.path) {
    return 'allow';
  }
  return isHttp ? 'external' : 'block';
}

/** True when a bridge message was posted by a page served from the LetsBot origin. */
export function isTrustedSource(sourceUrl: string | undefined, baseUrl: string): boolean {
  if (!sourceUrl) {
    return false;
  }
  const source = parseUrl(sourceUrl);
  const base = parseUrl(baseUrl);
  return source !== null && base !== null && source.origin === base.origin;
}

export type BridgeEvent =
  | { lb: 'ready' }
  | { lb: 'token_invalid' }
  | { lb: 'close' }
  | { lb: 'open_url'; url: string }
  | { lb: 'unread'; count: number }
  | { lb: 'message'; t: string }
  | { lb: 'error'; code: string }
  /** API.md §8.1: status-bar icon style over the header + header / background colours (`#rrggbb`, lower case). */
  | { lb: 'chrome'; lightStatusBar: boolean; header?: string; background?: string };

/** Parses a page → native message. Returns null for anything that is not a valid LetsBot event. */
export function parseBridgeMessage(data: unknown): BridgeEvent | null {
  if (typeof data !== 'string' || data.length > 64 * 1024) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const msg = value as Record<string, unknown>;
  switch (msg.lb) {
    case 'ready':
    case 'token_invalid':
    case 'close':
      return { lb: msg.lb };
    case 'open_url':
      return typeof msg.url === 'string' && isHttpUrl(msg.url)
        ? { lb: 'open_url', url: msg.url }
        : null;
    case 'unread': {
      const count = Number(msg.count);
      return Number.isInteger(count) && count >= 0 ? { lb: 'unread', count } : null;
    }
    case 'message':
      return typeof msg.t === 'string' ? { lb: 'message', t: msg.t } : null;
    case 'error':
      return typeof msg.code === 'string' ? { lb: 'error', code: msg.code } : null;
    case 'chrome':
      return parseChrome(msg);
    default:
      return null;
  }
}

function parseChrome(msg: Record<string, unknown>): BridgeEvent | null {
  if (msg.statusBar !== 'light' && msg.statusBar !== 'dark') {
    return null;
  }
  const event: { lb: 'chrome'; lightStatusBar: boolean; header?: string; background?: string } = {
    lb: 'chrome',
    lightStatusBar: msg.statusBar === 'light',
  };
  for (const field of ['header', 'background'] as const) {
    const raw = msg[field];
    if (raw === undefined || raw === null) {
      continue;
    }
    const hex = normalizeHex(raw);
    if (!hex) {
      return null;
    }
    event[field] = hex;
  }
  return event;
}

export interface BootPayload {
  token: string;
  appId: string;
  platform: string;
  sdk: string;
  context: Record<string, unknown>;
  /** Optional brand colour override (see README "Contract notes"). */
  color?: string;
  /** Safe-area insets in CSS px (API.md §8.1). */
  insets?: ChatInsets;
}

/** Serialises a value for safe embedding in injected JavaScript. */
export function toJsLiteral(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Builds the script that calls `window.LetsBotHost.<method>(arg)` if the host API exists. */
export function buildHostCall(
  method: 'boot' | 'setContext' | 'setTheme' | 'setInsets',
  arg: unknown
): string {
  return `(function(){try{var h=window.LetsBotHost;if(h&&typeof h.${method}==='function'){h.${method}(${toJsLiteral(
    arg
  )});}}catch(e){}})();true;`;
}
