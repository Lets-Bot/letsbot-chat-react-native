# Changelog

All notable changes to `@letsbot/react-native-chat` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-10-09

### Changed
- Edge-to-edge chat screen: `<LetsBotProvider>` opens the chat as a full-screen modal on both platforms (was a page
  sheet on iOS) with translucent status and navigation bars on Android. The chat page paints its header colour under
  the status bar / notch and keeps its composer above the home indicator, the navigation bar and the keyboard.
- `<LetsBotChatView>` passes the safe-area insets that overlap it to the page (`boot({ insets })`, then
  `LetsBotHost.setInsets` on rotation, keyboard and bar changes; CSS px, the Android keyboard included in `bottom`).
  Insets come from `react-native-safe-area-context` when installed or from the new `insets` prop.
- `X-LB-SDK` is now `react-native/0.2.0`.

### Added
- Handles the page's `chrome` event: the status-bar style follows the chat header while the chat is under the status
  bar (restored on unmount) and the view / WebView background follows the page background, so no white flashes show
  on open, close, rotation or keyboard animations.
- The last chrome colours are remembered per theme for the app session and used before the page paints the next time;
  otherwise a neutral colour (your brand colour for the header, if set) is used.

## 0.1.0 — 2026-10-08

First release.

### Added
- `LetsBot.configure({ appKey, appId, appVersion, baseUrl, locale, theme, color, storage, timeoutMs, on* })`.
- Hosted LetsBot chat screen: `<LetsBotChatView />` for embedding, and `<LetsBotProvider>` + `LetsBot.show()` /
  `LetsBot.hide()` for a ready-made modal. «Powered by LetsBot» credit is always shown by the hosted screen.
- Locked-down WebView: only the LetsBot `ui` URL loads in the chat; other http(s) links open in the system browser;
  other schemes are blocked; bridge messages are accepted only from the LetsBot origin.
- Visitor session stored in secure storage (react-native-keychain by default; `createExpoSecureStoreAdapter` for
  Expo), automatic recovery from `invalid_visitor` / `token_invalid`.
- Verified identity: `LetsBot.identify({ userId, identityToken, name, email, phone })`, `LetsBot.logout()`; a
  different user identifying on the same device starts a fresh visitor.
- Push: `LetsBot.setPushToken(token, { provider, sandbox })`, `LetsBot.removePushToken()`,
  `isLetsBotNotification(data)`, `LetsBot.handleNotification(data)` (works on cold start before the provider mounts).
- Unread badge: `useLetsBotUnread()`, `LetsBot.addUnreadListener()`, `LetsBot.refreshUnread()`; refreshed when the app
  returns to the foreground and when the chat closes.
- `LetsBot.setContext()`, `LetsBot.setLocale()`, `LetsBot.setTheme()`.
- Events: `onOpen`, `onClose`, `onMessage`, `onUnreadChanged`, `onError` (config callbacks or `LetsBot.on(...)`).
- Typed `LetsBotError` with the API error codes.
- Expo config plugin adding iOS camera / photo library / microphone usage descriptions and Android microphone
  permissions.
- Helpers `appInfoFromDeviceInfo()` / `appInfoFromExpoApplication()`.
- Install straight from GitHub without the npm registry
  (`npm install github:Lets-Bot/letsbot-chat-react-native#0.1.0`): a `prepare` script builds `lib/` on install.
