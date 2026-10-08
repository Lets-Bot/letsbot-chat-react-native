import type { LetsBotError } from './errors';
import type { StorageAdapter } from './storage';

/** Chat theme. `auto` follows the device appearance. */
export type LetsBotTheme = 'auto' | 'light' | 'dark';

/** Push provider of the token passed to `setPushToken`. */
export type LetsBotPushProvider = 'fcm' | 'apns';

/** Free-form context shown to the team and the AI assistant (e.g. current screen, order id). */
export type LetsBotContext = Record<string, string | number | boolean | null>;

export interface LetsBotEventHandlers {
  /** The chat screen became visible. */
  onOpen?: () => void;
  /** The chat screen was dismissed. */
  onClose?: () => void;
  /** A message from the team / AI arrived while the chat screen is open. */
  onMessage?: (message: LetsBotIncomingMessage) => void;
  /** The unread count changed. */
  onUnreadChanged?: (count: number) => void;
  /** Something failed (also thrown by the async API that caused it). */
  onError?: (error: LetsBotError) => void;
}

export interface LetsBotConfig extends LetsBotEventHandlers {
  /** Public App Key from LetsBot panel → Channels → In-App Chat. Safe to ship. */
  appKey: string;
  /**
   * iOS bundle id / Android applicationId. Must be registered in the LetsBot panel.
   * Use `appInfoFromDeviceInfo()` or `appInfoFromExpoApplication()` to read it at runtime.
   */
  appId: string;
  /** Your app version (shown to the team, sent with push device registration). */
  appVersion?: string;
  /** LetsBot origin. Default `https://letsbot.net`. */
  baseUrl?: string;
  /** Chat language (`ar`, `en`, `es`, `pt`; others fall back to English). Default: device language. */
  locale?: string;
  /** Chat theme. Default `auto`. */
  theme?: LetsBotTheme;
  /** Brand colour (`#RRGGBB`) overriding the colour configured in the panel. */
  color?: string;
  /**
   * Secure storage for the visitor token. Default: react-native-keychain.
   * Expo: `createExpoSecureStoreAdapter(SecureStore)`.
   */
  storage?: StorageAdapter;
  /** Network timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
}

export interface LetsBotIdentity {
  /** Your stable internal user id (the JWT `sub`). Used locally to detect user switches. */
  userId: string;
  /** JWT (HS256) issued by your backend with the Identity Secret. Never ship the secret in the app. */
  identityToken: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface LetsBotPushOptions {
  /** Default `fcm` (Firebase Cloud Messaging on both platforms). Use `apns` for raw APNs device tokens. */
  provider?: LetsBotPushProvider;
  /** APNs only: `true` for development (sandbox) builds. */
  sandbox?: boolean;
}

export interface LetsBotIncomingMessage {
  /** Message text. Do not log it. */
  text: string;
}

/** Last unread message summary returned by `GET unread`. */
export interface LetsBotUnreadLast {
  t: string;
  at: string | null;
}

export interface LetsBotUnreadState {
  count: number;
  last: LetsBotUnreadLast | null;
}

/** Function returned by listener APIs. Call it (or `.remove()`) to unsubscribe. */
export interface LetsBotSubscription {
  (): void;
  remove(): void;
}
