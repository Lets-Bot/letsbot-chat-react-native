/** SDK version. Kept in step with `package.json` (checked by a unit test). */
export const SDK_VERSION = '0.2.0';

/** Value sent in the `X-LB-SDK` header and in device payloads. */
export const SDK_HEADER = `react-native/${SDK_VERSION}`;

/** Default LetsBot origin. Override with `configure({ baseUrl })`. */
export const DEFAULT_BASE_URL = 'https://letsbot.net';
