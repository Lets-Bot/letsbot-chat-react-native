/**
 * Push payload helpers (API.md §6). LetsBot pushes carry `lb: "1"`, `lb_k: <appKey>`, `lb_c: <cursor>` in the data
 * map. Accepts either the data map itself (FCM `remoteMessage.data`, APNs userInfo) or an object holding it under
 * `data` (e.g. `remoteMessage`, Expo `notification.request.content`).
 */
export type LetsBotNotificationData = Record<string, unknown>;

function dataMap(payload: unknown): LetsBotNotificationData | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as LetsBotNotificationData;
  if ('lb' in record) {
    return record;
  }
  const nested = record.data;
  if (nested && typeof nested === 'object' && 'lb' in nested) {
    return nested as LetsBotNotificationData;
  }
  return null;
}

/** True when the payload is a LetsBot In-App Chat notification (`data.lb == "1"`). */
export function isLetsBotNotification(payload: unknown): boolean {
  const data = dataMap(payload);
  return data !== null && String(data.lb) === '1';
}

/** App Key the notification was sent for (`lb_k`), if present. */
export function notificationAppKey(payload: unknown): string | null {
  const data = dataMap(payload);
  const key = data?.lb_k;
  return typeof key === 'string' && key !== '' ? key : null;
}
