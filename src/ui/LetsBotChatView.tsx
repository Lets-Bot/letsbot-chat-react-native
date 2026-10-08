import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
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
 */
export function LetsBotChatView({ onClose, style, renderLoading, renderError }: LetsBotChatViewProps) {
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
    webViewRef.current?.injectJavaScript(buildHostCall('boot', core.bootPayload(value)));
  }, []);

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
      }
    },
    [boot]
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

  const background = scheme === 'dark' ? '#111315' : '#ffffff';
  const foreground = scheme === 'dark' ? '#f2f2f2' : '#1b1d1f';

  const shownError = configured ? error : NOT_CONFIGURED;
  if (shownError) {
    if (renderError) {
      return <View style={[styles.container, style]}>{renderError(shownError, retry)}</View>;
    }
    return (
      <View style={[styles.container, styles.center, { backgroundColor: background }, style]}>
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
      <ActivityIndicator />
    </View>
  );

  if (!token || !source) {
    return <View style={[styles.container, { backgroundColor: background }, style]}>{loading}</View>;
  }

  return (
    <View style={[styles.container, { backgroundColor: background }, style]}>
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
