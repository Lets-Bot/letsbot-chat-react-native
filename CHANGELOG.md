# Changelog

All notable changes to `@letsbot/react-native-chat` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
