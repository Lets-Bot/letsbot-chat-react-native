import type { LetsBotError } from './errors';
import type { LetsBotIncomingMessage, LetsBotSubscription } from './types';

export interface LetsBotEventMap {
  open: [];
  close: [];
  message: [LetsBotIncomingMessage];
  unreadChanged: [number];
  error: [LetsBotError];
}

export type LetsBotEventName = keyof LetsBotEventMap;
export type LetsBotListener<E extends LetsBotEventName> = (...args: LetsBotEventMap[E]) => void;

/** Creates a callable subscription that also exposes `.remove()`. */
export function makeSubscription(remove: () => void): LetsBotSubscription {
  let done = false;
  const unsubscribe = (() => {
    if (!done) {
      done = true;
      remove();
    }
  }) as LetsBotSubscription;
  unsubscribe.remove = unsubscribe;
  return unsubscribe;
}

/** Tiny typed event emitter. Listener exceptions are isolated so one bad listener cannot break the SDK. */
export class Emitter {
  private readonly listeners: { [E in LetsBotEventName]?: Set<LetsBotListener<E>> } = {};

  on<E extends LetsBotEventName>(event: E, listener: LetsBotListener<E>): LetsBotSubscription {
    let set = this.listeners[event] as Set<LetsBotListener<E>> | undefined;
    if (!set) {
      set = new Set();
      (this.listeners as Record<string, Set<unknown>>)[event] = set;
    }
    set.add(listener);
    return makeSubscription(() => {
      set.delete(listener);
    });
  }

  emit<E extends LetsBotEventName>(event: E, ...args: LetsBotEventMap[E]): void {
    const set = this.listeners[event] as Set<LetsBotListener<E>> | undefined;
    if (!set) {
      return;
    }
    for (const listener of Array.from(set)) {
      try {
        listener(...args);
      } catch {
        // Ignore listener failures.
      }
    }
  }

  clear(): void {
    for (const key of Object.keys(this.listeners)) {
      delete (this.listeners as Record<string, unknown>)[key];
    }
  }
}
