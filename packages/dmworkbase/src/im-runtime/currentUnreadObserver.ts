import { WKSDK } from 'wukongimjssdk';
import WKApp from '../App';
import { addImChannelInfoListener } from './channelRuntime';
import { getCurrentImUnreadCount } from './unreadCount';
import { createUnreadCountObserver, type UnreadCountObserver } from './unreadObserver';

const observers = new WeakMap<WKSDK, UnreadCountObserver>();
const reportError = (error: unknown) => console.error('[im-unread] observer failed', error);

export function getCurrentImUnreadObserver(): UnreadCountObserver {
  const sdk = WKSDK.shared();
  const existing = observers.get(sdk);
  if (existing) return existing;
  const observer = createUnreadCountObserver({
    readCount: getCurrentImUnreadCount,
    subscribeChanges: (listener) => {
      const cleanups: Array<() => void> = [];
      const dispose = () => {
        for (const cleanup of cleanups.splice(0).reverse()) {
          try {
            cleanup();
          } catch (error) {
            reportError(error);
          }
        }
      };
      try {
        sdk.conversationManager.addConversationListener(listener);
        cleanups.push(() => sdk.conversationManager.removeConversationListener(listener));
        cleanups.push(addImChannelInfoListener(sdk, listener));
        WKApp.mittBus.on('conversation-list-refreshed', listener);
        cleanups.push(() => WKApp.mittBus.off('conversation-list-refreshed', listener));
      } catch (error) {
        dispose();
        throw error;
      }
      return dispose;
    },
    onError: reportError,
  });
  observers.set(sdk, observer);
  return observer;
}
