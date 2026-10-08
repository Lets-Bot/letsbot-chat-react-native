import { LetsBotError } from './errors';

/**
 * Secure key/value storage used for the visitor token.
 * Implementations MUST be backed by the platform's secure storage (Keychain / Keystore).
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Subset of `react-native-keychain` used by {@link createKeychainAdapter}. */
export interface KeychainModuleLike {
  getGenericPassword(options?: {
    service?: string;
  }): Promise<false | { password: string }>;
  setGenericPassword(
    username: string,
    password: string,
    options?: { service?: string; accessible?: string }
  ): Promise<unknown>;
  resetGenericPassword(options?: { service?: string }): Promise<boolean>;
  ACCESSIBLE?: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY?: string };
}

/** Subset of `expo-secure-store` used by {@link createExpoSecureStoreAdapter}. */
export interface ExpoSecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: object): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY?: unknown;
}

const SERVICE_PREFIX = 'net.letsbot.chat.';

/** Builds a storage adapter on top of `react-native-keychain` (one keychain service per key). */
export function createKeychainAdapter(
  keychain: KeychainModuleLike
): StorageAdapter {
  const accessible = keychain.ACCESSIBLE?.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY;
  return {
    async getItem(key) {
      const result = await keychain.getGenericPassword({
        service: SERVICE_PREFIX + key,
      });
      return result ? result.password : null;
    },
    async setItem(key, value) {
      await keychain.setGenericPassword('letsbot', value, {
        service: SERVICE_PREFIX + key,
        ...(accessible ? { accessible } : {}),
      });
    },
    async removeItem(key) {
      await keychain.resetGenericPassword({ service: SERVICE_PREFIX + key });
    },
  };
}

/**
 * Builds a storage adapter on top of `expo-secure-store`.
 *
 * ```ts
 * import * as SecureStore from 'expo-secure-store';
 * LetsBot.configure({ ..., storage: createExpoSecureStoreAdapter(SecureStore) });
 * ```
 */
export function createExpoSecureStoreAdapter(
  secureStore: ExpoSecureStoreLike
): StorageAdapter {
  const options =
    secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY !== undefined
      ? {
          keychainAccessible: secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        }
      : undefined;
  return {
    getItem: (key) => secureStore.getItemAsync(key),
    setItem: (key, value) => secureStore.setItemAsync(key, value, options),
    removeItem: (key) => secureStore.deleteItemAsync(key),
  };
}

/** Non-persistent adapter. Intended for tests only: tokens are lost on restart. */
export function createMemoryStorageAdapter(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}

/**
 * Default adapter: `react-native-keychain` when installed. Resolved lazily so apps that pass their own
 * adapter (e.g. Expo + expo-secure-store) do not need it.
 */
export function createDefaultStorageAdapter(): StorageAdapter {
  let resolved: StorageAdapter | null = null;
  const resolve = (): StorageAdapter => {
    if (resolved) {
      return resolved;
    }
    let keychain: KeychainModuleLike | undefined;
    try {
      // Optional peer dependency (Metro treats a require inside try/catch as optional).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-keychain');
      keychain = (mod?.default ?? mod) as KeychainModuleLike;
    } catch (cause) {
      throw new LetsBotError('storage_unavailable', { cause });
    }
    if (!keychain || typeof keychain.getGenericPassword !== 'function') {
      throw new LetsBotError('storage_unavailable');
    }
    resolved = createKeychainAdapter(keychain);
    return resolved;
  };
  return {
    getItem: async (key) => resolve().getItem(key),
    setItem: async (key, value) => resolve().setItem(key, value),
    removeItem: async (key) => resolve().removeItem(key),
  };
}

/** Storage keys are limited to `[A-Za-z0-9._-]` (expo-secure-store requirement). */
export function storageKey(kind: 'visitor' | 'user', appKey: string): string {
  return `letsbot.${kind}.${appKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
