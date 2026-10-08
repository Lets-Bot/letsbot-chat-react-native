import type {
  LetsBotEventName,
  LetsBotListener,
} from './emitter';
import { core } from './instance';
import { isLetsBotNotification } from './notifications';
import type {
  LetsBotConfig,
  LetsBotContext,
  LetsBotIdentity,
  LetsBotPushOptions,
  LetsBotSubscription,
  LetsBotTheme,
  LetsBotUnreadState,
} from './types';
import { SDK_VERSION } from './version';

/**
 * LetsBot In-App Chat SDK entry point.
 *
 * ```ts
 * LetsBot.configure({ appKey: 'YOUR_APP_KEY', appId: 'com.acme.app', locale: 'en' });
 * LetsBot.show(); // with <LetsBotProvider> mounted at the root
 * ```
 */
export const LetsBot = {
  /** SDK version. */
  version: SDK_VERSION,

  /** Configures the SDK. Call once at startup (calling again updates locale / theme / colour / callbacks). */
  configure(config: LetsBotConfig): void {
    core.configure(config);
  },

  /** Links the visitor to your logged-in user with a short-lived identity token (JWT HS256) from your backend. */
  identify(identity: LetsBotIdentity): Promise<void> {
    return core.identify(identity);
  },

  /** Resets the chat on this device. Call it before clearing your own session on logout. */
  logout(): Promise<void> {
    return core.logout();
  },

  /** Opens the chat screen (requires `<LetsBotProvider>` at the root of your app). */
  show(): void {
    core.show();
  },

  /** Dismisses the chat screen opened with `show()`. */
  hide(): void {
    core.hide();
  },

  /** Registers the device push token (FCM by default; pass `{ provider: 'apns' }` for raw APNs tokens). */
  setPushToken(token: string, options?: LetsBotPushOptions): Promise<void> {
    return core.setPushToken(token, options);
  },

  /** Unregisters the push token passed to `setPushToken` from LetsBot. */
  removePushToken(): Promise<void> {
    return core.removePushToken();
  },

  /** True when a notification payload / data map belongs to LetsBot (`data.lb == "1"`). */
  isLetsBotNotification(data: unknown): boolean {
    return isLetsBotNotification(data);
  },

  /** Opens the chat for a LetsBot notification. Returns false (and does nothing) for other notifications. */
  handleNotification(data: unknown): boolean {
    return core.handleNotification(data);
  },

  /** Current unread count. */
  get unreadCount(): number {
    return core.getUnreadCount();
  },

  /** Current unread count and last unread message summary. */
  getUnread(): LetsBotUnreadState {
    return core.getUnreadState();
  },

  /** Fetches the unread count now. Resolves to 0 when the visitor has never chatted. */
  refreshUnread(): Promise<number> {
    return core.refreshUnread();
  },

  /** Listens to unread count changes (called immediately with the current value). Returns an unsubscribe function. */
  addUnreadListener(listener: (count: number) => void): LetsBotSubscription {
    return core.addUnreadListener(listener);
  },

  /** Sets what the user is looking at (screen, order id, …); visible to the team and the AI assistant. */
  setContext(context: LetsBotContext | null): void {
    core.setContext(context);
  },

  /** Changes the chat language (`ar`, `en`, `es`, `pt`; others fall back to English). */
  setLocale(locale: string): void {
    core.setLocale(locale);
  },

  /** Changes the chat theme (`auto`, `light`, `dark`). */
  setTheme(theme: LetsBotTheme): void {
    core.setTheme(theme);
  },

  /** Subscribes to an SDK event: `open`, `close`, `message`, `unreadChanged`, `error`. */
  on<E extends LetsBotEventName>(event: E, listener: LetsBotListener<E>): LetsBotSubscription {
    return core.on(event, listener);
  },
};

export type LetsBotApi = typeof LetsBot;
