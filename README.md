# LetsBot In-App Chat for React Native

[![npm](https://img.shields.io/npm/v/@letsbot/react-native-chat.svg)](https://www.npmjs.com/package/@letsbot/react-native-chat)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Add the LetsBot chat to your React Native or Expo app. Your users chat with the same LetsBot AI assistant and team
that already answer your business on WhatsApp and on your website, and every conversation lands in the LetsBot inbox.

- Ready-made chat screen (text, buttons, cards, images/PDF, voice notes, RTL, dark mode, 4 languages)
- Verified identity: one conversation per user across devices and reinstalls
- Push notifications (FCM / APNs) and an unread badge
- Expo config plugin

Docs: <https://letsbot.net/developers/in-app-chat> · Support: support@letsbot.net

## Requirements

| | Minimum |
|---|---|
| React Native | 0.73 |
| React | 18.2 |
| react-native-webview | 13.6 |
| iOS / Android | same as your React Native version |
| Expo | Development build (prebuild / EAS). **Expo Go is not supported.** |

You need a LetsBot **App Key** (LetsBot panel → Channels → In-App Chat) and your iOS bundle id / Android
applicationId registered under **Platforms**.

## Install

### Bare React Native

```sh
npm install @letsbot/react-native-chat@0.1.0 react-native-webview react-native-keychain
cd ios && pod install
```

Add to `ios/<App>/Info.plist` (use your own wording, localized for every language your app supports):

```xml
<key>NSCameraUsageDescription</key>
<string>Allow the app to use the camera to send photos in support chat.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Allow the app to access your photos to send them in support chat.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Allow the app to use the microphone to record voice messages in support chat.</string>
```

Add to `android/app/src/main/AndroidManifest.xml` (voice notes):

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

### Expo

```sh
npx expo install @letsbot/react-native-chat react-native-webview expo-secure-store expo-application
```

`app.json`:

```json
{
  "expo": {
    "plugins": [
      ["@letsbot/react-native-chat", {
        "cameraPermission": "Allow $(PRODUCT_NAME) to use the camera to send photos in support chat.",
        "photosPermission": "Allow $(PRODUCT_NAME) to access your photos to send them in support chat.",
        "microphonePermission": "Allow $(PRODUCT_NAME) to record voice messages in support chat."
      }]
    ]
  }
}
```

All plugin options are optional: without them the plugin adds sensible English defaults, and it never overwrites
descriptions you already set in `ios.infoPlist`. Pass `"microphone": false` to skip the microphone permission (voice
notes will then be unavailable). Rebuild the native app (`npx expo prebuild` / `eas build`) after adding the plugin.

## Quick start

Configure once, as early as possible (your root `index.js` / `App.tsx`), and wrap the app in `<LetsBotProvider>`:

```tsx
import { LetsBot, LetsBotProvider, appInfoFromDeviceInfo } from '@letsbot/react-native-chat';
import DeviceInfo from 'react-native-device-info';

LetsBot.configure({
  appKey: 'YOUR_APP_KEY',
  ...appInfoFromDeviceInfo(DeviceInfo), // { appId: bundle id / applicationId, appVersion }
  locale: 'en',                         // your app's current language
  theme: 'auto',                        // 'auto' | 'light' | 'dark'
});

export default function App() {
  return (
    <LetsBotProvider>
      <RootNavigator />
    </LetsBotProvider>
  );
}
```

### App id and version

`appId` must be the iOS bundle id / Android applicationId registered in the LetsBot panel. Pass it as a string, or
read it at runtime with either helper (neither package is a dependency of this SDK — use the one you already have):

```ts
// react-native-device-info
import DeviceInfo from 'react-native-device-info';
LetsBot.configure({ appKey, ...appInfoFromDeviceInfo(DeviceInfo) });

// Expo: expo-application
import * as Application from 'expo-application';
LetsBot.configure({ appKey, ...appInfoFromExpoApplication(Application) });
```

### Secure storage

The visitor token is kept in secure storage only. By default the SDK uses `react-native-keychain` (Keychain on iOS,
Keystore-backed storage on Android). In Expo, pass `expo-secure-store`:

```ts
import * as SecureStore from 'expo-secure-store';
import { createExpoSecureStoreAdapter } from '@letsbot/react-native-chat';

LetsBot.configure({ appKey, appId, storage: createExpoSecureStoreAdapter(SecureStore) });
```

Any object implementing `StorageAdapter` (`getItem` / `setItem` / `removeItem`, all async) works, as long as it is
backed by the platform's secure storage.

## Open the chat

```tsx
// Modal (needs <LetsBotProvider>)
<Button title="Help" onPress={() => LetsBot.show()} />

// Or embed the screen in your own navigator
import { LetsBotChatView } from '@letsbot/react-native-chat';

function SupportScreen({ navigation }) {
  return <LetsBotChatView onClose={() => navigation.goBack()} />;
}
```

### Unread badge

```tsx
import { useLetsBotUnread } from '@letsbot/react-native-chat';

function HelpButton() {
  const unread = useLetsBotUnread();
  return <IconWithBadge name="help" badge={unread} onPress={() => LetsBot.show()} />;
}

// Outside React:
const unsubscribe = LetsBot.addUnreadListener((count) => setBadge(count));
unsubscribe(); // when disposed
```

The count refreshes when the app returns to the foreground, when the chat closes, and on `LetsBot.refreshUnread()`.
It is `0` while the chat is open. No network call is made for users who have never opened the chat.

### Context

Tell the team and the AI assistant what the user is looking at:

```ts
LetsBot.setContext({ screen: 'order_details', orderId: '1234' });
LetsBot.show();
```

### Language and theme

```ts
LetsBot.setLocale('ar'); // ar, en, es, pt (others fall back to English). Arabic is right-to-left.
LetsBot.setTheme('dark'); // follow your app's own light/dark toggle
```

## Logged-in users (verified identity)

1. On **your backend**, add an authenticated endpoint that returns a short-lived identity token for the current user —
   a JWT, `HS256`, signed with your **Identity Secret** (LetsBot panel → In-App Chat → Keys), with claims
   `{ sub: <stable user id>, iat, exp }` (24 h recommended, max 7 days) and optional `name`, `email`, `phone`.
   Node: `createIdentityToken({ userId, secret: process.env.LETSBOT_IDENTITY_SECRET, expiresIn: '24h' })` from
   `@letsbot/sdk`. **Never put the Identity Secret in the app.**
2. In the app, after login and on every app start while logged in:

   ```ts
   const { token } = await api.get('/letsbot/identity-token');
   await LetsBot.identify({ userId: user.id, identityToken: token, name: user.name, email: user.email });
   ```

   When `identify` rejects with `identity_expired`, fetch a new token and call it again.
3. On logout, call `await LetsBot.logout()` **before** clearing your own session, so the next person on the device
   does not see the previous user's conversation. If a different `userId` identifies on the same device, the SDK starts
   a fresh visitor automatically.

Guests can chat without `identify`; when they log in later, `identify` links them.

## Push notifications

LetsBot sends pushes with **your** credentials (upload the FCM service-account JSON or the APNs `.p8` key in LetsBot
panel → In-App Chat → Notifications). The SDK only needs the device token and a hook in your notification handlers.
Use your existing push setup — do not add a second provider.

### React Native Firebase (FCM on iOS and Android)

```ts
import messaging from '@react-native-firebase/messaging';

const token = await messaging().getToken();
await LetsBot.setPushToken(token); // provider defaults to 'fcm'
messaging().onTokenRefresh((t) => LetsBot.setPushToken(t));

// Tap from background / cold start
messaging().onNotificationOpenedApp((message) => {
  if (LetsBot.isLetsBotNotification(message.data)) LetsBot.handleNotification(message.data);
});
const initial = await messaging().getInitialNotification();
if (initial && LetsBot.isLetsBotNotification(initial.data)) LetsBot.handleNotification(initial.data);
```

### Expo Notifications

```ts
import * as Notifications from 'expo-notifications';

const device = await Notifications.getDevicePushTokenAsync(); // native FCM / APNs token, not the Expo push token
await LetsBot.setPushToken(String(device.data), {
  provider: Platform.OS === 'ios' ? 'apns' : 'fcm',
  sandbox: __DEV__, // APNs development builds
});

Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;
  if (LetsBot.isLetsBotNotification(data)) LetsBot.handleNotification(data);
});
```

Raw APNs device tokens need `{ provider: 'apns' }` (and `sandbox: true` for development builds). FCM tokens — including
FCM on iOS — use the default `'fcm'`.

`handleNotification` returns `false` for anything that is not a LetsBot notification, so your other notifications keep
their existing handling. It works on cold start too: the chat opens as soon as `<LetsBotProvider>` mounts. The SDK
registers the push token only once a chat session exists (first chat open or `identify`), so it never creates empty
visitors on app start. Call `LetsBot.removePushToken()` to unregister. On Android 13+, request `POST_NOTIFICATIONS` at a
sensible moment.

## Events

```ts
LetsBot.configure({
  appKey, appId,
  onOpen: () => {},
  onClose: () => {},
  onMessage: ({ text }) => {}, // a reply arrived while the chat is open (do not log the text)
  onUnreadChanged: (count) => {},
  onError: (error) => console.warn(error.code),
});

// or any number of listeners:
const off = LetsBot.on('error', (error) => report(error.code));
off();
```

## API

| | |
|---|---|
| `LetsBot.configure(config)` | `appKey`, `appId` (required), `appVersion`, `baseUrl` (default `https://letsbot.net`), `locale`, `theme`, `color` (`#RRGGBB`), `storage`, `timeoutMs`, `onOpen` / `onClose` / `onMessage` / `onUnreadChanged` / `onError` |
| `LetsBot.identify({ userId, identityToken, name?, email?, phone? })` | `Promise<void>` |
| `LetsBot.logout()` | `Promise<void>` |
| `LetsBot.show()` / `LetsBot.hide()` | modal (needs `<LetsBotProvider>`) |
| `<LetsBotChatView onClose? style? renderLoading? renderError? />` | embeddable chat screen |
| `<LetsBotProvider modalProps? chatViewProps?>` | hosts the modal |
| `LetsBot.setPushToken(token, { provider?: 'fcm' \| 'apns', sandbox? })` | `Promise<void>` |
| `LetsBot.removePushToken()` | `Promise<void>` |
| `LetsBot.isLetsBotNotification(data)` / `isLetsBotNotification(data)` | `boolean` (accepts the data map or an object with `data`) |
| `LetsBot.handleNotification(data)` | `boolean` — opens the chat for LetsBot notifications |
| `useLetsBotUnread()` | `number` |
| `LetsBot.addUnreadListener(cb)` | unsubscribe function (also has `.remove()`) |
| `LetsBot.unreadCount` / `LetsBot.getUnread()` / `LetsBot.refreshUnread()` | current count / `{ count, last }` / `Promise<number>` |
| `LetsBot.setContext(ctx)` / `LetsBot.setLocale(locale)` / `LetsBot.setTheme(theme)` | |
| `LetsBot.on(event, cb)` | `open`, `close`, `message`, `unreadChanged`, `error` |
| `LetsBotError` | `code`, `status?`, `retryAfter?` |

## Error codes

Every async method rejects with a `LetsBotError` (also passed to `onError`).

| `code` | Meaning | Fix |
|---|---|---|
| `not_found` | Unknown App Key, app disabled/deleted, or In-App Chat unavailable for the workspace | Check the App Key; check the app in LetsBot panel → In-App Chat |
| `app_not_registered` | This bundle id / applicationId is not registered | Add it in LetsBot panel → In-App Chat → Platforms (check `appId` in `configure`) |
| `invalid_visitor` | Visitor session expired | Handled automatically (new session) |
| `identity_invalid` | Identity token has a bad signature, is malformed, or no Identity Secret is configured | Sign with the right secret, `HS256`, claims `sub`/`iat`/`exp` |
| `identity_expired` | Identity token `exp` has passed | Fetch a new token from your backend and call `identify` again |
| `blocked` | The business blocked this visitor | — |
| `invalid`, `too_long`, `invalid_contact`, `consent_required`, `file_too_big`, `file_type` | Validation | Fix the value |
| `slow_down`, `busy` | Rate limit / budget | Retry after `error.retryAfter` seconds |
| `not_configured` | Called before `LetsBot.configure()` | Configure at startup |
| `invalid_argument` | Missing / malformed argument | See the message |
| `network`, `timeout` | No connection / request timed out | Retry; the chat screen shows a retry button |
| `storage_unavailable` | No secure storage | Install `react-native-keychain` or pass `storage` (Expo: `createExpoSecureStoreAdapter`) |
| `provider_missing` | `LetsBot.show()` without `<LetsBotProvider>` (dev warning; the chat opens once a provider mounts) | Wrap your app in `<LetsBotProvider>` |
| `unknown` | Unexpected response | Contact support@letsbot.net |

## Troubleshooting

- **Blank screen / `app_not_registered`** — `appId` must exactly match a registered bundle id / applicationId (debug
  builds with a suffix such as `.debug` must be registered too).
- **Expo Go shows an error** — the SDK needs a development build (`npx expo run:ios`, `eas build --profile development`).
- **`storage_unavailable` in Expo** — pass `storage: createExpoSecureStoreAdapter(SecureStore)`.
- **No push on iOS** — FCM tokens need the APNs key uploaded to Firebase; raw APNs tokens need `{ provider: 'apns' }`
  and the right `sandbox` flag. Push is never sent while the chat is open and connected.
- **Voice notes do nothing** — the microphone permission is missing (Info.plist / `RECORD_AUDIO`), or the user denied
  it in system settings.
- **Links open in the browser** — by design: the chat screen only ever shows LetsBot's chat page.

## Security

- The App Key is public. The Identity Secret and push credentials never belong in the app.
- The visitor token lives only in secure storage (Keychain / Keystore). The SDK never logs tokens or message text.
- The WebView loads only the LetsBot chat page. Other http(s) links open in the system browser; any other scheme
  (`tel:`, `intent:`, custom schemes, `javascript:`, `file:`) is blocked. Bridge messages are accepted only from the
  LetsBot origin; cookies and file access are disabled.

## Contract notes

- `configure({ color })` is forwarded to the hosted screen as an extra `color` field of
  `window.LetsBotHost.boot(...)`. The current API contract does not define a colour override for the `ui` route, so
  pages that do not read it fall back to the colour configured in the LetsBot panel.

## Example

[`example/`](example) is an Expo app (development build) showing the modal and embedded chat, unread badge, identity,
locale switch, theme and push wiring:

```sh
npm install && cd example && npm install
cp .env.example .env   # set EXPO_PUBLIC_LETSBOT_APP_KEY
npx expo run:ios       # or run:android
```

## License

[MIT](LICENSE) © 2026 LetsBot
