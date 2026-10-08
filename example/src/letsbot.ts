import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import {
  LetsBot,
  appInfoFromExpoApplication,
  createExpoSecureStoreAdapter,
} from '@letsbot/react-native-chat';

export const APP_KEY = process.env.EXPO_PUBLIC_LETSBOT_APP_KEY ?? 'YOUR_APP_KEY';
const IDENTITY_ENDPOINT = process.env.EXPO_PUBLIC_IDENTITY_ENDPOINT;

/** Call once, before the first render. */
export function setupLetsBot(): void {
  LetsBot.configure({
    appKey: APP_KEY,
    // Bundle id / applicationId + version, read at runtime (must be registered in the LetsBot panel).
    ...appInfoFromExpoApplication(Application),
    // Expo apps use expo-secure-store (Keychain / Keystore) instead of react-native-keychain.
    storage: createExpoSecureStoreAdapter(SecureStore),
    theme: 'auto',
    onError: (error) => {
      // Never log tokens or message text — the code is enough.
      console.warn(`[LetsBot] ${error.code}`);
    },
  });
}

/**
 * Logs the demo user in: asks YOUR backend for a short-lived identity token (JWT HS256 signed with the Identity
 * Secret, which never ships in the app), then links the chat to that user.
 */
export async function loginDemoUser(userId: string): Promise<void> {
  if (!IDENTITY_ENDPOINT) {
    throw new Error('Set EXPO_PUBLIC_IDENTITY_ENDPOINT to your backend identity-token endpoint.');
  }
  const response = await fetch(IDENTITY_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Identity endpoint answered ${response.status}`);
  }
  const { token } = (await response.json()) as { token: string };
  await LetsBot.identify({ userId, identityToken: token, name: 'Demo User' });
}
