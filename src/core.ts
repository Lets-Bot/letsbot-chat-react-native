import { AppState, Appearance, Platform } from 'react-native';
import type { AppStateStatus, NativeEventSubscription } from 'react-native';

import { buildHostCall, normalizeBaseUrl } from './bridge';
import type { BootPayload } from './bridge';
import { Emitter } from './emitter';
import type { LetsBotEventName, LetsBotListener } from './emitter';
import { LetsBotError, asLetsBotError } from './errors';
import { ApiClient } from './http';
import { isLetsBotNotification, notificationAppKey } from './notifications';
import { createDefaultStorageAdapter, storageKey } from './storage';
import type { StorageAdapter } from './storage';
import type {
  LetsBotConfig,
  LetsBotContext,
  LetsBotIdentity,
  LetsBotPushOptions,
  LetsBotPushProvider,
  LetsBotSubscription,
  LetsBotTheme,
  LetsBotUnreadState,
} from './types';
import { DEFAULT_BASE_URL, SDK_HEADER } from './version';

/** Presenter registered by `<LetsBotProvider>` so `LetsBot.show()` / `hide()` can drive its modal. */
export interface LetsBotPresenter {
  show(): void;
  hide(): void;
}

/** Handle registered by a mounted chat view so the core can push context / theme updates into the page. */
export interface ChatViewHandle {
  inject(script: string): void;
}

interface ResolvedConfig {
  appKey: string;
  appId: string;
  appVersion?: string;
  baseUrl: string;
  locale: string;
  theme: LetsBotTheme;
  color?: string;
  storage: StorageAdapter;
  timeoutMs: number;
}

interface PushRegistration {
  token: string;
  provider: LetsBotPushProvider;
  sandbox: boolean;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const THEMES: readonly LetsBotTheme[] = ['auto', 'light', 'dark'];

declare const __DEV__: boolean | undefined;
const isDev = (): boolean => typeof __DEV__ !== 'undefined' && !!__DEV__;

/** Normalises a locale tag to its primary language subtag (`ar-SA` → `ar`). */
export function normalizeLocale(locale: string | undefined | null): string {
  if (!locale) {
    return 'auto';
  }
  const primary = String(locale).trim().split(/[-_]/)[0]?.toLowerCase() ?? '';
  return /^[a-z]{2,3}$/.test(primary) ? primary : 'auto';
}

function deviceLocale(): string {
  try {
    return normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'auto';
  }
}

function isSilentBackgroundError(error: LetsBotError): boolean {
  return error.code === 'network' || error.code === 'timeout';
}

/**
 * SDK state machine: configuration, visitor session (secure storage), identity, push registration, unread count,
 * context and presentation. Exposed publicly through the `LetsBot` facade.
 */
export class LetsBotCore {
  private config: ResolvedConfig | null = null;
  private api: ApiClient | null = null;
  private readonly emitter = new Emitter();
  private configHandlers: Partial<LetsBotConfig> = {};

  private token: string | null = null;
  private tokenLoaded = false;
  private loadPromise: Promise<string | null> | null = null;
  private sessionPromise: Promise<string> | null = null;
  /** Bumped on logout / reconfigure so in-flight session results are discarded. */
  private generation = 0;

  private context: LetsBotContext = {};
  private unread: LetsBotUnreadState = { count: 0, last: null };

  private push: PushRegistration | null = null;
  private pushRegisteredKey: string | null = null;

  private presenters: LetsBotPresenter[] = [];
  private pendingShow = false;
  private views = new Set<ChatViewHandle>();

  private appStateSub: NativeEventSubscription | null = null;
  private appearanceSub: { remove(): void } | null = null;

  // ---------------------------------------------------------------------------------------------------------------
  // Configuration

  configure(options: LetsBotConfig): void {
    if (!options || typeof options.appKey !== 'string' || options.appKey.trim() === '') {
      throw new LetsBotError('invalid_argument', { message: 'configure(): appKey is required.' });
    }
    if (typeof options.appId !== 'string' || options.appId.trim() === '') {
      throw new LetsBotError('invalid_argument', {
        message:
          'configure(): appId (iOS bundle id / Android applicationId) is required. See appInfoFromDeviceInfo() / appInfoFromExpoApplication().',
      });
    }
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    if (!baseUrl) {
      throw new LetsBotError('invalid_argument', { message: 'configure(): baseUrl must be an http(s) URL.' });
    }
    if (options.theme !== undefined && !THEMES.includes(options.theme)) {
      throw new LetsBotError('invalid_argument', { message: 'configure(): theme must be auto, light or dark.' });
    }
    if (options.color !== undefined && !COLOR_RE.test(options.color)) {
      throw new LetsBotError('invalid_argument', { message: 'configure(): color must be #RRGGBB.' });
    }

    const appKey = options.appKey.trim();
    const appId = options.appId.trim();
    const previous = this.config;
    const identityChanged =
      !previous ||
      previous.appKey !== appKey ||
      previous.baseUrl !== baseUrl ||
      previous.appId !== appId ||
      (options.storage !== undefined && options.storage !== previous.storage);

    this.config = {
      appKey,
      appId,
      appVersion: options.appVersion,
      baseUrl,
      locale: options.locale ? normalizeLocale(options.locale) : (previous?.locale ?? deviceLocale()),
      theme: options.theme ?? previous?.theme ?? 'auto',
      color: options.color ?? previous?.color,
      storage: options.storage ?? previous?.storage ?? createDefaultStorageAdapter(),
      timeoutMs: options.timeoutMs ?? 15000,
    };
    this.configHandlers = {
      onOpen: options.onOpen,
      onClose: options.onClose,
      onMessage: options.onMessage,
      onUnreadChanged: options.onUnreadChanged,
      onError: options.onError,
    };
    this.api = new ApiClient({
      baseUrl,
      appKey,
      appId,
      platform: Platform.OS,
      timeoutMs: this.config.timeoutMs,
    });

    if (identityChanged) {
      this.generation++;
      this.token = null;
      this.tokenLoaded = false;
      this.loadPromise = null;
      this.sessionPromise = null;
      this.pushRegisteredKey = null;
      this.setUnreadState({ count: 0, last: null });
    }

    this.startLifecycleListeners();
    this.refreshUnreadInBackground();
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  private requireConfig(): { config: ResolvedConfig; api: ApiClient } {
    if (!this.config || !this.api) {
      throw new LetsBotError('not_configured');
    }
    return { config: this.config, api: this.api };
  }

  private startLifecycleListeners(): void {
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'active') {
          this.refreshUnreadInBackground();
        }
      });
    }
    if (!this.appearanceSub && Appearance?.addChangeListener) {
      this.appearanceSub = Appearance.addChangeListener(({ colorScheme }) => {
        if (this.config?.theme === 'auto' && (colorScheme === 'dark' || colorScheme === 'light')) {
          this.injectAll(buildHostCall('setTheme', colorScheme));
        }
      });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Session

  private async loadToken(): Promise<string | null> {
    if (this.tokenLoaded) {
      return this.token;
    }
    if (!this.loadPromise) {
      const { config } = this.requireConfig();
      const generation = this.generation;
      this.loadPromise = config.storage
        .getItem(storageKey('visitor', config.appKey))
        .then((value) => {
          if (generation === this.generation && !this.tokenLoaded) {
            this.token = value || null;
            this.tokenLoaded = true;
          }
          return this.token;
        })
        .catch((cause) => {
          this.loadPromise = null;
          throw cause instanceof LetsBotError ? cause : new LetsBotError('storage_unavailable', { cause });
        });
    }
    return this.loadPromise;
  }

  private async storeToken(token: string | null): Promise<void> {
    const { config } = this.requireConfig();
    const key = storageKey('visitor', config.appKey);
    try {
      if (token) {
        await config.storage.setItem(key, token);
      } else {
        await config.storage.removeItem(key);
      }
    } catch (cause) {
      throw cause instanceof LetsBotError ? cause : new LetsBotError('storage_unavailable', { cause });
    }
  }

  /** Returns the visitor token, creating a session (`POST session`) when none is stored. */
  async ensureSession(): Promise<string> {
    const existing = await this.loadToken();
    if (existing) {
      return existing;
    }
    return this.createSession();
  }

  /** Discards the current token and creates a new session (used on `invalid_visitor` / `token_invalid`). */
  async renewSession(): Promise<string> {
    if (this.sessionPromise) {
      return this.sessionPromise;
    }
    this.token = null;
    this.tokenLoaded = true;
    this.pushRegisteredKey = null;
    await this.storeToken(null).catch(() => undefined);
    return this.createSession();
  }

  private createSession(): Promise<string> {
    if (this.sessionPromise) {
      return this.sessionPromise;
    }
    const { config, api } = this.requireConfig();
    const generation = this.generation;
    const promise = (async () => {
      const response = await api.request<{ token?: unknown }>('POST', 'session', {
        body: {
          locale: config.locale,
          device: this.deviceInfo(),
          ctx: this.context,
        },
      });
      const token = typeof response?.token === 'string' ? response.token : '';
      if (!token) {
        throw new LetsBotError('unknown', { message: 'LetsBot returned no visitor token.' });
      }
      if (generation !== this.generation) {
        throw new LetsBotError('invalid_visitor', { message: 'Session reset while it was being created.' });
      }
      await this.storeToken(token);
      this.token = token;
      this.tokenLoaded = true;
      this.registerPushInBackground();
      return token;
    })();
    this.sessionPromise = promise;
    const clear = () => {
      if (this.sessionPromise === promise) {
        this.sessionPromise = null;
      }
    };
    promise.then(clear, clear);
    return promise;
  }

  /** Runs an authenticated request; on `invalid_visitor` the token is replaced once and the request retried. */
  private async withVisitor<T>(run: (token: string) => Promise<T>): Promise<T> {
    const token = await this.ensureSession();
    try {
      return await run(token);
    } catch (error) {
      if (error instanceof LetsBotError && error.code === 'invalid_visitor') {
        const fresh = this.token === token ? await this.renewSession() : await this.ensureSession();
        return run(fresh);
      }
      throw error;
    }
  }

  private deviceInfo() {
    const config = this.config!;
    return {
      platform: Platform.OS,
      app_id: config.appId,
      app_version: config.appVersion,
      sdk: SDK_HEADER,
      os_version: String(Platform.Version ?? ''),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Identity

  async identify(identity: LetsBotIdentity): Promise<void> {
    try {
      const { config, api } = this.requireConfig();
      if (!identity || typeof identity.userId !== 'string' || identity.userId === '') {
        throw new LetsBotError('invalid_argument', { message: 'identify(): userId is required.' });
      }
      if (typeof identity.identityToken !== 'string' || identity.identityToken === '') {
        throw new LetsBotError('invalid_argument', { message: 'identify(): identityToken is required.' });
      }
      const userKey = storageKey('user', config.appKey);
      const previousUser = await config.storage.getItem(userKey).catch(() => null);
      if (previousUser && previousUser !== identity.userId) {
        // A different user on this device: start from a clean visitor so conversations never leak.
        await this.resetVisitor();
      }
      const body: Record<string, string> = { identity_token: identity.identityToken };
      if (identity.name) body.name = identity.name;
      if (identity.email) body.email = identity.email;
      if (identity.phone) body.phone = identity.phone;
      await this.withVisitor((visitor) => api.request('POST', 'identify', { body, visitor }));
      await config.storage.setItem(userKey, identity.userId).catch(() => undefined);
    } catch (error) {
      throw this.report(error);
    }
  }

  /** Ends the identified session on this device. Call it before clearing your own auth session. */
  async logout(): Promise<void> {
    try {
      await this.resetVisitor();
    } catch (error) {
      throw this.report(error);
    }
  }

  private async resetVisitor(): Promise<void> {
    const { config, api } = this.requireConfig();
    const token = await this.loadToken().catch(() => null);
    this.generation++;
    this.sessionPromise = null;
    this.token = null;
    this.tokenLoaded = true;
    this.pushRegisteredKey = null;
    this.hide();
    this.setUnreadState({ count: 0, last: null });
    if (token) {
      await api.request('POST', 'logout', { visitor: token }).catch(() => undefined);
    }
    await this.storeToken(null);
    await config.storage.removeItem(storageKey('user', config.appKey)).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Push

  /**
   * Registers the device push token. If no visitor session exists yet, the token is kept and registered as soon as
   * one is created (first chat open or identify), so the SDK never creates empty visitors on app start.
   */
  async setPushToken(token: string, options: LetsBotPushOptions = {}): Promise<void> {
    try {
      this.requireConfig();
      if (typeof token !== 'string' || token.trim() === '') {
        throw new LetsBotError('invalid_argument', { message: 'setPushToken(): token is required.' });
      }
      const provider = options.provider ?? 'fcm';
      if (provider !== 'fcm' && provider !== 'apns') {
        throw new LetsBotError('invalid_argument', { message: 'setPushToken(): provider must be fcm or apns.' });
      }
      this.push = { token: token.trim(), provider, sandbox: !!options.sandbox };
      const visitor = await this.loadToken();
      if (visitor) {
        await this.registerPush();
      }
    } catch (error) {
      throw this.report(error);
    }
  }

  /** Unregisters the current push token from LetsBot (`DELETE device`). */
  async removePushToken(): Promise<void> {
    try {
      const { api } = this.requireConfig();
      const push = this.push;
      this.push = null;
      this.pushRegisteredKey = null;
      const visitor = await this.loadToken();
      if (push && visitor) {
        await api.request('DELETE', 'device', { body: { token: push.token }, visitor });
      }
    } catch (error) {
      throw this.report(error);
    }
  }

  private pushKey(visitor: string, push: PushRegistration): string {
    return [visitor, push.provider, push.token, push.sandbox ? 1 : 0, this.config?.locale].join('|');
  }

  private async registerPush(): Promise<void> {
    const { config, api } = this.requireConfig();
    const push = this.push;
    if (!push) {
      return;
    }
    await this.withVisitor(async (visitor) => {
      const key = this.pushKey(visitor, push);
      if (this.pushRegisteredKey === key) {
        return;
      }
      await api.request('PUT', 'device', {
        visitor,
        body: {
          provider: push.provider,
          token: push.token,
          platform: Platform.OS,
          app_id: config.appId,
          app_version: config.appVersion,
          sdk: SDK_HEADER,
          locale: config.locale,
          sandbox: push.sandbox,
        },
      });
      this.pushRegisteredKey = key;
    });
  }

  private registerPushInBackground(): void {
    if (!this.push) {
      return;
    }
    this.registerPush().catch((error) => {
      const err = asLetsBotError(error);
      if (!isSilentBackgroundError(err)) {
        this.report(err);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Unread

  getUnreadCount(): number {
    return this.unread.count;
  }

  getUnreadState(): LetsBotUnreadState {
    return this.unread;
  }

  /** Listener is called immediately with the current count, then on every change. */
  addUnreadListener(listener: (count: number) => void): LetsBotSubscription {
    const sub = this.emitter.on('unreadChanged', listener);
    try {
      listener(this.unread.count);
    } catch {
      // Ignore listener failures.
    }
    return sub;
  }

  /** Fetches the unread count (`GET unread`). Does not create a session when none exists. */
  async refreshUnread(): Promise<number> {
    try {
      const { api } = this.requireConfig();
      if (this.views.size > 0) {
        return this.unread.count;
      }
      const token = await this.loadToken();
      if (!token) {
        this.setUnreadState({ count: 0, last: null });
        return 0;
      }
      let response: { count?: unknown; last?: unknown };
      try {
        response = await api.request('GET', 'unread', { visitor: token });
      } catch (error) {
        if (error instanceof LetsBotError && error.code === 'invalid_visitor' && this.token === token) {
          this.token = null;
          this.pushRegisteredKey = null;
          await this.storeToken(null).catch(() => undefined);
          this.setUnreadState({ count: 0, last: null });
          return 0;
        }
        throw error;
      }
      if (this.views.size > 0) {
        return this.unread.count;
      }
      const count = Math.max(0, Math.floor(Number(response?.count) || 0));
      const lastRaw = response?.last as { t?: unknown; at?: unknown } | null | undefined;
      const last =
        lastRaw && typeof lastRaw === 'object' && typeof lastRaw.t === 'string'
          ? { t: lastRaw.t, at: typeof lastRaw.at === 'string' ? lastRaw.at : null }
          : null;
      this.setUnreadState({ count, last });
      return count;
    } catch (error) {
      throw this.report(error);
    }
  }

  private refreshUnreadInBackground(): void {
    if (!this.config) {
      return;
    }
    this.refreshUnread().catch(() => undefined);
  }

  /** Called by the chat view when the page reports an unread count. */
  setUnreadFromPage(count: number): void {
    this.setUnreadState({ count, last: count === 0 ? null : this.unread.last });
  }

  private setUnreadState(next: LetsBotUnreadState): void {
    const changed = next.count !== this.unread.count;
    this.unread = next;
    if (changed) {
      this.emitter.emit('unreadChanged', next.count);
      this.safeCall(() => this.configHandlers.onUnreadChanged?.(next.count));
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Context / locale / theme

  setContext(context: LetsBotContext | null): void {
    this.context = context && typeof context === 'object' ? { ...context } : {};
    this.injectAll(buildHostCall('setContext', this.context));
  }

  getContext(): LetsBotContext {
    return { ...this.context };
  }

  setLocale(locale: string): void {
    const { config } = this.requireConfig();
    const next = normalizeLocale(locale);
    if (next === config.locale) {
      return;
    }
    this.config = { ...config, locale: next };
    this.registerPushInBackground();
    this.localeListeners.forEach((listener) => listener(next));
  }

  setTheme(theme: LetsBotTheme): void {
    const { config } = this.requireConfig();
    if (!THEMES.includes(theme)) {
      throw new LetsBotError('invalid_argument', { message: 'setTheme(): theme must be auto, light or dark.' });
    }
    this.config = { ...config, theme };
    const resolved = theme === 'auto' ? (Appearance?.getColorScheme?.() ?? 'light') : theme;
    this.injectAll(buildHostCall('setTheme', resolved === 'dark' ? 'dark' : 'light'));
  }

  private localeListeners = new Set<(locale: string) => void>();

  /** Internal: chat views re-load the page when the locale changes. */
  onLocaleChange(listener: (locale: string) => void): () => void {
    this.localeListeners.add(listener);
    return () => {
      this.localeListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Presentation

  /** Internal: registered by `<LetsBotProvider>`. */
  registerPresenter(presenter: LetsBotPresenter): () => void {
    this.presenters.push(presenter);
    if (this.pendingShow) {
      this.pendingShow = false;
      presenter.show();
    }
    return () => {
      this.presenters = this.presenters.filter((p) => p !== presenter);
    };
  }

  show(): void {
    const presenter = this.presenters[this.presenters.length - 1];
    if (presenter) {
      this.pendingShow = false;
      presenter.show();
      return;
    }
    // Keep the request so a provider mounting later (cold start from a notification) opens the chat.
    this.pendingShow = true;
    if (isDev()) {
      console.warn(new LetsBotError('provider_missing').message);
    }
  }

  hide(): void {
    this.pendingShow = false;
    this.presenters[this.presenters.length - 1]?.hide();
  }

  /** Opens the chat for LetsBot notifications. Returns false for any other payload (leave it to your app). */
  handleNotification(payload: unknown): boolean {
    if (!isLetsBotNotification(payload)) {
      return false;
    }
    const key = notificationAppKey(payload);
    if (key && this.config && key !== this.config.appKey) {
      return false;
    }
    this.show();
    return true;
  }

  /** Internal: called by `<LetsBotChatView>` on mount. */
  attachView(handle: ChatViewHandle): () => void {
    const wasEmpty = this.views.size === 0;
    this.views.add(handle);
    if (wasEmpty) {
      this.setUnreadState({ count: 0, last: null });
      this.emitter.emit('open');
      this.safeCall(() => this.configHandlers.onOpen?.());
    }
    return () => {
      if (!this.views.delete(handle)) {
        return;
      }
      if (this.views.size === 0) {
        this.emitter.emit('close');
        this.safeCall(() => this.configHandlers.onClose?.());
        this.refreshUnreadInBackground();
      }
    };
  }

  isChatVisible(): boolean {
    return this.views.size > 0;
  }

  private injectAll(script: string): void {
    this.views.forEach((view) => {
      try {
        view.inject(script);
      } catch {
        // View may be unmounting.
      }
    });
  }

  /** Internal: URL of the hosted chat screen (`GET ui`). */
  uiUrl(): string {
    const { config, api } = this.requireConfig();
    const query = [
      `l=${encodeURIComponent(config.locale)}`,
      `theme=${encodeURIComponent(config.theme)}`,
      `p=${encodeURIComponent(Platform.OS)}`,
    ].join('&');
    return `${api.apiBase}/ui?${query}`;
  }

  /** Internal: headers for the WebView `ui` request. */
  uiHeaders(): Record<string, string> {
    const { api } = this.requireConfig();
    const headers = api.baseHeaders();
    headers.Accept = 'text/html';
    return headers;
  }

  getLocale(): string {
    return this.requireConfig().config.locale;
  }

  getBaseUrl(): string {
    return this.requireConfig().config.baseUrl;
  }

  /** Internal: payload for `window.LetsBotHost.boot(...)`. */
  bootPayload(token: string): BootPayload {
    const { config } = this.requireConfig();
    const payload: BootPayload = {
      token,
      appId: config.appId,
      platform: Platform.OS,
      sdk: SDK_HEADER,
      context: { ...this.context },
    };
    if (config.color) {
      payload.color = config.color;
    }
    return payload;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Events

  on<E extends LetsBotEventName>(event: E, listener: LetsBotListener<E>): LetsBotSubscription {
    return this.emitter.on(event, listener);
  }

  emitMessage(text: string): void {
    const message = { text };
    this.emitter.emit('message', message);
    this.safeCall(() => this.configHandlers.onMessage?.(message));
  }

  /** Emits `error` and returns the typed error (so callers can `throw this.report(e)`). */
  report(error: unknown): LetsBotError {
    const err = asLetsBotError(error);
    this.emitter.emit('error', err);
    this.safeCall(() => this.configHandlers.onError?.(err));
    return err;
  }

  private safeCall(fn: () => void): void {
    try {
      fn();
    } catch {
      // Ignore app callback failures.
    }
  }

  /** Internal (tests): drops all state and listeners. */
  reset(): void {
    this.appStateSub?.remove();
    this.appearanceSub?.remove();
    this.appStateSub = null;
    this.appearanceSub = null;
    this.emitter.clear();
    this.localeListeners.clear();
    this.config = null;
    this.api = null;
    this.configHandlers = {};
    this.token = null;
    this.tokenLoaded = false;
    this.loadPromise = null;
    this.sessionPromise = null;
    this.generation++;
    this.context = {};
    this.unread = { count: 0, last: null };
    this.push = null;
    this.pushRegisteredKey = null;
    this.presenters = [];
    this.pendingShow = false;
    this.views.clear();
  }
}

