/** App identity passed to `LetsBot.configure`. */
export interface LetsBotAppInfo {
  appId: string;
  appVersion?: string;
}

/** Subset of `react-native-device-info` used by {@link appInfoFromDeviceInfo}. */
export interface DeviceInfoLike {
  getBundleId(): string;
  getVersion(): string;
}

/** Subset of `expo-application` used by {@link appInfoFromExpoApplication}. */
export interface ExpoApplicationLike {
  applicationId: string | null;
  nativeApplicationVersion: string | null;
}

/**
 * Reads the bundle id / applicationId and version from `react-native-device-info`.
 *
 * ```ts
 * import DeviceInfo from 'react-native-device-info';
 * LetsBot.configure({ appKey, ...appInfoFromDeviceInfo(DeviceInfo) });
 * ```
 */
export function appInfoFromDeviceInfo(deviceInfo: DeviceInfoLike): LetsBotAppInfo {
  return {
    appId: deviceInfo.getBundleId(),
    appVersion: deviceInfo.getVersion() || undefined,
  };
}

/**
 * Reads the bundle id / applicationId and version from `expo-application`.
 *
 * ```ts
 * import * as Application from 'expo-application';
 * LetsBot.configure({ appKey, ...appInfoFromExpoApplication(Application) });
 * ```
 */
export function appInfoFromExpoApplication(
  application: ExpoApplicationLike
): LetsBotAppInfo {
  return {
    appId: application.applicationId ?? '',
    appVersion: application.nativeApplicationVersion ?? undefined,
  };
}
