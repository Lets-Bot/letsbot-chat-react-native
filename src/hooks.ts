import { useSyncExternalStore } from 'react';

import { core } from './instance';

/**
 * Unread count of LetsBot team / AI messages, for a badge on your chat entry point.
 * Re-renders on every change; refreshed when the app returns to the foreground and when the chat closes.
 */
export function useLetsBotUnread(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void): () => void {
  return core.on('unreadChanged', () => onChange());
}

function getSnapshot(): number {
  return core.getUnreadCount();
}

function getServerSnapshot(): number {
  return 0;
}
