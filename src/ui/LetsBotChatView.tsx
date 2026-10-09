import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef, Context, ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewHttpErrorEvent,
  WebViewMessageEvent,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';

import {
  buildHostCall,
  decideNavigation,
  isHttpUrl,
  isTrustedSource,
  parseBridgeMessage,
} from '../bridge';
import { insetsPayload, isDarkColor, mergeChrome, neutralChrome, overlapInsets, sameInsets } from '../chrome';
import type { ChatChrome, ChatInsets, ViewFrame } from '../chrome';
import { LetsBotError, toErrorCode } from '../errors';
import { core } from '../instance';
import { SDK_HEADER } from '../version';
import { uiStrings } from './strings';

export interface LetsBotChatViewProps {
  /** Called when the user closes the chat from inside the screen (the hosted page's close button). */
  onClose?: () => void;
  /** Container style. Defaults to `flex: 1`. */
  style?: StyleProp<ViewStyle>;
  /** Custom loading indicator. */
  renderLoading?: () => ReactNode;
  /** Custom error state. Call `retry()` to try again. */
  renderError?: (error: LetsBotError, retry: () => void) => ReactNode;
  /**
   * Safe-area insets of the window (dp), e.g. `useSafeAreaInsets()` from `react-native-safe-area-context`. Optional:
   * by default the view reads them from `react-native-safe-area-context` when it is installed, else uses the
   * Android status-bar height. The view works out how much of them overlaps it and passes that to the page.
   */
  insets?: Partial<ChatInsets>;
}

/** Subset of `react-native-safe-area-context` used when it is installed (optional peer dependency). */
interface SafeAreaModuleLike {
  SafeAreaInsetsContext?: Context<Partial<ChatInsets> | null>;
  initialWindowMetrics?: { insets?: Partial<ChatInsets> } | null;
}

let safeAreaModule: SafeAreaModuleLike | null = null;
try {
  // Optional peer dependency (Metro treats a require inside try/catch as optional).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  safeAreaModule = require('react-native-safe-area-context') as SafeAreaModuleLike;
} catch {
  safeAreaModule = null;
}

const NoSafeAreaContext = createContext<Partial<ChatInsets> | null>(null);
const SafeAreaContext = safeAreaModule?.SafeAreaInsetsContext ?? NoSafeAreaContext;

/** Window safe-area insets: explicit prop, else safe-area-context, else the Android status-bar height. */
function useWindowInsets(override: Partial<ChatInsets> | undefined): ChatInsets {
  const fromContext = useContext(SafeAreaContext);
  if (override) {
    return insetsPayload(override);
  }
  if (fromContext) {
    return insetsPayload(fromContext);
  }
  const initial = safeAreaModule?.initialWindowMetrics?.insets;
  if (initial) {
    return insetsPayload(initial);
  }
  return insetsPayload({ top: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 });
}

/** Android: top of the keyboard in window coordinates while it is shown (iOS WebViews handle the keyboard). */
function useKeyboardTop(): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android' || typeof Keyboard?.addListener !== 'function') {
      return undefined;
    }
    const show = Keyboard.addListener('keyboardDidShow', (event) => setTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTop(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return top;
}

function openExternal(url: string): void {
  if (isHttpUrl(url)) {
    Linking.openURL(url).catch(() => undefined);
  }
}

function httpStatusError(status: number): LetsBotError {
  if (status === 404) {
    return new LetsBotError('not_found', { status });
  }
  if (status === 403) {
    return new LetsBotError('app_not_registered', { status });
  }
  if (status === 429) {
    return new LetsBotError('slow_down', { status });
  }
  return new LetsBotError('unknown', { status });
}

/**
 * The LetsBot chat screen (hosted UI in a locked-down WebView). Embed it in your own screen / navigator, or use
 * `<LetsBotProvider>` + `LetsBot.show()` for a ready-made modal. Requires `LetsBot.configure()` first.
 *
 * Edge-to-edge (API.md §8.1): give it the whole screen without a `SafeAreaView` / safe-area padding. The page paints
 * its header colour under the status bar and keeps its composer above the home indicator / navigation bar and the
 * keyboard, using the insets this view passes (`boot({insets})`, then `LetsBotHost.setInsets`). While the view sits
 * under the status bar, the status-bar style follows the chat header; the previous style comes back on unmount.
 */
export function LetsBotChatView({ onClose, style, renderLoading, renderError, insets: insetsProp }: LetsBotChatViewProps) {
  // `WebView`'s default generic (`P = undefined`) collapses its props to `never` under recent TypeScript.
  const webViewRef = useRef<WebView<object>>(null);
  const tokenRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<LetsBotError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageKey, setPageKey] = useState(0);
  const scheme = useColorScheme();

  const configured = core.isConfigured();
  const strings = uiStrings(configured ? core.getLocale() : undefined);

  // ---- edge-to-edge: insets ------------------------------------------------------------------------------------
  const containerRef = useRef<ComponentRef<typeof View>>(null);
  const [frame, setFrame] = useState<ViewFrame | null>(null);
  const windowSize = useWindowDimensions();
  const windowInsets = useWindowInsets(insetsProp);
  const keyboardTop = useKeyboardTop();
  const computed = overlapInsets(windowInsets, windowSize.width, windowSize.height, frame, keyboardTop);
  const [insets, setInsets] = useState<ChatInsets>(computed);
  if (!sameInsets(insets, computed)) {
    setInsets(computed);
  }
  const insetsRef = useRef<ChatInsets>(insets);
  useEffect(() => {
    insetsRef.current = insets;
  });
  const insetsSentRef = useRef<ChatInsets | null>(null);

  const measure = useCallback(() => {
    const node = containerRef.current;
    if (typeof node?.measureInWindow !== 'function') {
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setFrame((previous) =>
        previous &&
        previous.x === x &&
        previous.y === y &&
        previous.width === width &&
        previous.height === height
          ? previous
          : { x, y, width, height }
      );
    });
  }, []);
  const onLayout = useCallback((_event: LayoutChangeEvent) => measure(), [measure]);
  useEffect(measure, [measure, keyboardTop, windowSize.width, windowSize.height]);

  // ---- edge-to-edge: chrome (status bar + background) ----------------------------------------------------------
  const theme: 'light' | 'dark' = configured ? core.resolvedTheme() : scheme === 'dark' ? 'dark' : 'light';
  const [pageChrome, setPageChrome] = useState<{ theme: string; chrome: ChatChrome } | null>(null);
  const chrome: ChatChrome =
    pageChrome && pageChrome.theme === theme
      ? pageChrome.chrome
      : configured
        ? core.chromeFor(theme)
        : neutralChrome(theme === 'dark');
  const chromeRef = useRef(chrome);
  useEffect(() => {
    chromeRef.current = chrome;
  });

  // Register as visible (unread = 0, open/close events, context/theme pushes).
  useEffect(() => {
    if (!configured) {
      return undefined;
    }
    return core.attachView({
      inject: (script) => webViewRef.current?.injectJavaScript(script),
    });
  }, [configured]);

  // Reload the page when the locale changes.
  useEffect(() => {
    if (!configured) {
      return undefined;
    }
    return core.onLocaleChange(() => setPageKey((k) => k + 1));
  }, [configured]);

  // Ensure a visitor session.
  useEffect(() => {
    let cancelled = false;
    if (!configured) {
      core.report(new LetsBotError('not_configured'));
      return undefined;
    }
    core
      .ensureSession()
      .then((value) => {
        if (!cancelled) {
          tokenRef.current = value;
          setToken(value);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(core.report(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [configured, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setToken(null);
    setAttempt((n) => n + 1);
    setPageKey((k) => k + 1);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on locale reloads (pageKey)
  const uiUrl = useMemo(() => (configured ? core.uiUrl() : ''), [configured, pageKey]);
  const source = useMemo(
    () => (configured ? { uri: uiUrl, headers: core.uiHeaders() } : undefined),
    [configured, uiUrl]
  );

  const boot = useCallback((value: string) => {
    const current = insetsRef.current;
    insetsSentRef.current = current;
    webViewRef.current?.injectJavaScript(buildHostCall('boot', core.bootPayload(value, current)));
  }, []);

  // A reloaded page boots again on `ready`; nothing is sent to it before.
  useEffect(() => {
    insetsSentRef.current = null;
  }, [pageKey]);

  // Rotation, keyboard, bar changes → LetsBotHost.setInsets (only after boot, only when they changed).
  useEffect(() => {
    if (!insetsSentRef.current || sameInsets(insetsSentRef.current, insets)) {
      return;
    }
    insetsSentRef.current = insets;
    webViewRef.current?.injectJavaScript(buildHostCall('setInsets', insets));
  }, [insets]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (!isTrustedSource(event.nativeEvent.url, core.getBaseUrl())) {
        return;
      }
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message) {
        return;
      }
      switch (message.lb) {
        case 'ready':
          if (tokenRef.current) {
            boot(tokenRef.current);
          }
          break;
        case 'token_invalid':
          core
            .renewSession()
            .then((fresh) => {
              tokenRef.current = fresh;
              setToken(fresh);
              boot(fresh);
            })
            .catch((err: unknown) => setError(core.report(err)));
          break;
        case 'close':
          onCloseRef.current?.();
          break;
        case 'open_url':
          openExternal(message.url);
          break;
        case 'unread':
          core.setUnreadFromPage(message.count);
          break;
        case 'message':
          core.emitMessage(message.t);
          break;
        case 'error':
          core.report(new LetsBotError(toErrorCode(message.code)));
          break;
        case 'chrome': {
          const pageTheme = core.resolvedTheme();
          const next = mergeChrome(chromeRef.current, message);
          chromeRef.current = next;
          core.saveChrome(pageTheme, next);
          setPageChrome({ theme: pageTheme, chrome: next });
          break;
        }
      }
    },
    [boot, setPageChrome]
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      const decision = decideNavigation({ url: request.url, isTopFrame: request.isTopFrame }, uiUrl);
      if (decision === 'external') {
        openExternal(request.url);
      }
      return decision === 'allow';
    },
    [uiUrl]
  );

  const onOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    openExternal(event.nativeEvent.targetUrl);
  }, []);

  const onHttpError = useCallback((event: WebViewHttpErrorEvent) => {
    const { statusCode, url } = event.nativeEvent;
    if (url && url.split('?')[0] === uiUrl.split('?')[0]) {
      setError(core.report(httpStatusError(statusCode)));
    }
  }, [uiUrl]);

  const background = chrome.background;
  const darkBackground = isDarkColor(chrome.background);
  const foreground = darkBackground ? '#f2f2f2' : '#1b1d1f';
  // Status-bar icons follow the chat header while the view sits under the status bar; <StatusBar> pops this
  // style again on unmount, so the app's previous style comes back.
  const statusBar =
    insets.top > 0 ? (
      <StatusBar barStyle={chrome.lightStatusBar ? 'light-content' : 'dark-content'} animated />
    ) : null;
  const safePadding = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };
  const containerProps = { ref: containerRef, onLayout, collapsable: false } as const;

  const shownError = configured ? error : NOT_CONFIGURED;
  if (shownError) {
    if (renderError) {
      return (
        <View {...containerProps} style={[styles.container, { backgroundColor: background }, style]}>
          {statusBar}
          <View style={[styles.container, safePadding]}>{renderError(shownError, retry)}</View>
        </View>
      );
    }
    return (
      <View
        {...containerProps}
        style={[styles.container, styles.center, { backgroundColor: background }, style, safePadding]}
      >
        {statusBar}
        <Text style={[styles.title, { color: foreground }]}>{strings.unavailable}</Text>
        {shownError.code === 'network' || shownError.code === 'timeout' ? (
          <Text style={[styles.body, { color: foreground }]}>{strings.offline}</Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
            <Text style={styles.buttonText}>{strings.retry}</Text>
          </Pressable>
          {onClose ? (
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.button, styles.secondary]}>
              <Text style={[styles.buttonText, { color: foreground }]}>{strings.close}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const loading = renderLoading ? (
    renderLoading()
  ) : (
    <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: background }]}>
      <ActivityIndicator color={darkBackground ? '#f2f2f2' : undefined} />
    </View>
  );

  if (!token || !source) {
    return (
      <View {...containerProps} style={[styles.container, { backgroundColor: background }, style]}>
        {statusBar}
        {loading}
      </View>
    );
  }

  return (
    <View {...containerProps} style={[styles.container, { backgroundColor: background }, style]}>
      {statusBar}
      <WebView<object>
        key={pageKey}
        ref={webViewRef}
        source={source}
        style={{ backgroundColor: background }}
        // Every navigation is decided by onShouldStartLoadWithRequest (ui URL only; other http(s) → system
        // browser; any other scheme blocked). A narrower whitelist would let the WebView hand non-http schemes to
        // Linking itself, which this SDK must not do.
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onOpenWindow={onOpenWindow}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        onMessage={onMessage}
        onHttpError={onHttpError}
        onError={(event) => {
          // -999 (cancelled) / 102 (frame load interrupted) follow navigations this view blocked on purpose.
          const { code } = event.nativeEvent;
          if (code === -999 || code === 102) {
            return;
          }
          setError(core.report(new LetsBotError('network')));
        }}
        onContentProcessDidTerminate={() => webViewRef.current?.reload()}
        onRenderProcessGone={() => setPageKey((k) => k + 1)}
        startInLoadingState
        renderLoading={() => <>{loading}</>}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        cacheEnabled
        mixedContentMode="never"
        textZoom={100}
        bounces={false}
        overScrollMode="never"
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        applicationNameForUserAgent={`LetsBotSDK/${SDK_HEADER}`}
        webviewDebuggingEnabled={typeof __DEV__ !== 'undefined' && __DEV__}
      />
    </View>
  );
}

declare const __DEV__: boolean | undefined;

const NOT_CONFIGURED = new LetsBotError('not_configured');

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 15, marginTop: 8, textAlign: 'center', opacity: 0.8 },
  actions: { flexDirection: 'row', marginTop: 20, gap: 12 },
  button: { backgroundColor: '#0e7c66', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  secondary: { backgroundColor: 'transparent' },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
