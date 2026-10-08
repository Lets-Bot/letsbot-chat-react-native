/**
 * Error codes returned by the LetsBot SDK API (API.md §3), plus a few codes the SDK raises locally.
 */
export type LetsBotServerErrorCode =
  | 'not_found'
  | 'app_not_registered'
  | 'invalid_visitor'
  | 'identity_invalid'
  | 'identity_expired'
  | 'blocked'
  | 'invalid'
  | 'too_long'
  | 'invalid_contact'
  | 'consent_required'
  | 'file_too_big'
  | 'file_type'
  | 'slow_down'
  | 'busy';

export type LetsBotLocalErrorCode =
  /** A method was called before `LetsBot.configure()`. */
  | 'not_configured'
  /** A method was called with a missing or malformed argument. */
  | 'invalid_argument'
  /** The device is offline or the request could not reach LetsBot. */
  | 'network'
  /** The request took longer than the SDK timeout. */
  | 'timeout'
  /** The secure storage adapter failed (or no adapter is available). */
  | 'storage_unavailable'
  /** `LetsBot.show()` was called without a mounted `<LetsBotProvider>`. */
  | 'provider_missing'
  /** LetsBot answered with an unexpected status or body. */
  | 'unknown';

export type LetsBotErrorCode = LetsBotServerErrorCode | LetsBotLocalErrorCode;

const SERVER_CODES: ReadonlySet<string> = new Set<LetsBotServerErrorCode>([
  'not_found',
  'app_not_registered',
  'invalid_visitor',
  'identity_invalid',
  'identity_expired',
  'blocked',
  'invalid',
  'too_long',
  'invalid_contact',
  'consent_required',
  'file_too_big',
  'file_type',
  'slow_down',
  'busy',
]);

const MESSAGES: Record<LetsBotErrorCode, string> = {
  not_found:
    'LetsBot could not find this app. Check the App Key, and that In-App Chat is enabled for the workspace.',
  app_not_registered:
    'This bundle id / package name is not registered. Add it in LetsBot panel → Channels → In-App Chat → Platforms.',
  invalid_visitor: 'The visitor session expired. The SDK will start a new one.',
  identity_invalid:
    'The identity token is invalid (bad signature, malformed, or no Identity Secret configured).',
  identity_expired:
    'The identity token has expired. Fetch a new one from your backend and call identify() again.',
  blocked: 'This visitor has been blocked by the business.',
  invalid: 'LetsBot rejected the request as invalid.',
  too_long: 'The value is too long.',
  invalid_contact: 'The e-mail or phone number is invalid.',
  consent_required: 'Consent is required before continuing.',
  file_too_big: 'The file is too big.',
  file_type: 'This file type is not allowed.',
  slow_down: 'Too many requests. Try again shortly.',
  busy: 'LetsBot is busy right now. Try again shortly.',
  not_configured: 'Call LetsBot.configure({ appKey, appId }) before using the SDK.',
  invalid_argument: 'A required argument is missing or malformed.',
  network: 'Could not reach LetsBot. Check the device connection.',
  timeout: 'The request to LetsBot timed out.',
  storage_unavailable:
    'Secure storage is unavailable. Install react-native-keychain or pass a storage adapter to configure().',
  provider_missing: 'Wrap your app in <LetsBotProvider> to use LetsBot.show().',
  unknown: 'Unexpected response from LetsBot.',
};

export interface LetsBotErrorOptions {
  /** HTTP status when the error came from the API. */
  status?: number;
  /** Seconds to wait before retrying (from `Retry-After`), for `slow_down` / `busy`. */
  retryAfter?: number;
  /** Underlying error, if any. */
  cause?: unknown;
  /** Overrides the default human-readable message. */
  message?: string;
}

/** Typed error raised by every async LetsBot API and passed to `onError`. */
export class LetsBotError extends Error {
  /** Machine-readable code (API.md §3, or a local SDK code). */
  readonly code: LetsBotErrorCode;
  /** HTTP status when the error came from the API. */
  readonly status?: number;
  /** Seconds to wait before retrying, when LetsBot sent `Retry-After`. */
  readonly retryAfter?: number;
  /** Underlying error, if any. */
  readonly cause?: unknown;

  constructor(code: LetsBotErrorCode, options: LetsBotErrorOptions = {}) {
    super(options.message ?? MESSAGES[code] ?? MESSAGES.unknown);
    this.name = 'LetsBotError';
    this.code = code;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.cause = options.cause;
    Object.setPrototypeOf(this, LetsBotError.prototype);
  }
}

/** True when `value` is a {@link LetsBotError}. */
export function isLetsBotError(value: unknown): value is LetsBotError {
  return value instanceof LetsBotError;
}

/** Maps a raw server code to a known code (`unknown` otherwise). */
export function toErrorCode(raw: unknown): LetsBotErrorCode {
  return typeof raw === 'string' && SERVER_CODES.has(raw)
    ? (raw as LetsBotServerErrorCode)
    : 'unknown';
}

/** Wraps anything into a {@link LetsBotError}. */
export function asLetsBotError(error: unknown): LetsBotError {
  if (error instanceof LetsBotError) {
    return error;
  }
  return new LetsBotError('unknown', { cause: error });
}
