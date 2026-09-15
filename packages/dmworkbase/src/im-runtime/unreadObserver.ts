export interface UnreadCountObserverDeps {
  readCount(): number;
  subscribeChanges(listener: () => void): () => void;
  onError(error: unknown): void;
}

export interface UnreadCountObserver {
  getSnapshot(): number;
  subscribe(listener: (count: number) => void): () => void;
}

/** Share one upstream subscription while any UI or background owner observes it. */
export function createUnreadCountObserver(deps: UnreadCountObserverDeps): UnreadCountObserver {
  const subscriptions = new Set<{ listener: (count: number) => void }>();
  let unsubscribe: (() => void) | undefined;
  let starting = false;
  let publication = 0;

  const notify = (listener: (count: number) => void, count: number) => {
    try {
      listener(count);
    } catch (error) {
      deps.onError(error);
    }
  };

  const publish = () => {
    if (starting || subscriptions.size === 0) return;
    const currentPublication = ++publication;
    let count: number;
    try {
      count = deps.readCount();
    } catch (error) {
      deps.onError(error);
      return;
    }
    for (const subscription of Array.from(subscriptions)) {
      // A consumer may synchronously publish a newer source snapshot.
      if (currentPublication !== publication) break;
      if (subscriptions.has(subscription)) notify(subscription.listener, count);
    }
  };

  return {
    getSnapshot: () => deps.readCount(),
    subscribe(listener) {
      const subscription = { listener };
      subscriptions.add(subscription);
      const release = () => {
        if (!subscriptions.delete(subscription) || subscriptions.size > 0) return;
        const cleanup = unsubscribe;
        unsubscribe = undefined;
        cleanup?.();
      };
      try {
        if (!unsubscribe) {
          starting = true;
          try {
            unsubscribe = deps.subscribeChanges(publish);
          } finally {
            starting = false;
          }
        }
        notify(listener, deps.readCount());
      } catch (error) {
        release();
        throw error;
      }
      return release;
    },
  };
}
