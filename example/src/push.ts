import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { LetsBot } from '@letsbot/react-native-chat';

/**
 * Registers the native push token with LetsBot and routes LetsBot notifications to the chat.
 * Other notifications are left to the app. Returns a cleanup function.
 */
export function setupPush(): () => void {
  void (async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      // Native device token: FCM on Android, APNs on iOS (without Firebase).
      const device = await Notifications.getDevicePushTokenAsync();
      await LetsBot.setPushToken(String(device.data), {
        provider: Platform.OS === 'ios' ? 'apns' : 'fcm',
        sandbox: __DEV__,
      });
    } catch {
      // Push is optional in the example (needs a dev build with push credentials).
    }
  })();

  const tokenSub = Notifications.addPushTokenListener((device) => {
    void LetsBot.setPushToken(String(device.data), {
      provider: Platform.OS === 'ios' ? 'apns' : 'fcm',
      sandbox: __DEV__,
    }).catch(() => undefined);
  });

  // Taps (background / cold start).
  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (LetsBot.isLetsBotNotification(data)) {
      LetsBot.handleNotification(data);
    }
  });
  const last = Notifications.getLastNotificationResponse();
  if (last && LetsBot.isLetsBotNotification(last.notification.request.content.data)) {
    LetsBot.handleNotification(last.notification.request.content.data);
  }

  // Foreground: refresh the badge instead of opening the chat.
  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    if (LetsBot.isLetsBotNotification(notification.request.content.data)) {
      void LetsBot.refreshUnread().catch(() => undefined);
    }
  });

  return () => {
    tokenSub.remove();
    responseSub.remove();
    receivedSub.remove();
  };
}
