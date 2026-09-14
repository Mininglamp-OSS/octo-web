import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  count: 4,
  conversations: new Set<() => void>(),
  channels: new Set<() => void>(),
  refreshed: new Set<() => void>(),
  registeredEvents: [] as string[],
  failRegistration: false,
  failChannelCleanup: false,
}));

vi.mock('wukongimjssdk', () => {
  const sdk = {
    conversationManager: {
      addConversationListener: (listener: () => void) => state.conversations.add(listener),
      removeConversationListener: (listener: () => void) => state.conversations.delete(listener),
    },
    channelManager: {
      addListener: (listener: () => void) => state.channels.add(listener),
      removeListener: (listener: () => void) => {
        state.channels.delete(listener);
        if (state.failChannelCleanup) throw new Error('channel cleanup failed');
      },
    },
  };
  return { WKSDK: { shared: () => sdk } };
});
vi.mock('../App', () => ({
  default: {
    mittBus: {
      on: (event: string, listener: () => void) => {
        if (state.failRegistration) throw new Error('event bus unavailable');
        state.registeredEvents.push(event);
        state.refreshed.add(listener);
      },
      off: (_event: string, listener: () => void) => state.refreshed.delete(listener),
    },
  },
}));
vi.mock('./unreadCount', () => ({ getCurrentImUnreadCount: () => state.count }));

import { getCurrentImUnreadObserver } from './currentUnreadObserver';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  state.registeredEvents = [];
  state.count = 4;
  state.failRegistration = false;
  state.failChannelCleanup = false;
  vi.restoreAllMocks();
});

describe('current IM unread subscriptions', () => {
  it('shares one observer for the current SDK and does not connect IM', () => {
    expect(getCurrentImUnreadObserver()).toBe(getCurrentImUnreadObserver());
    const first = vi.fn();
    const second = vi.fn();
    cleanups.push(getCurrentImUnreadObserver().subscribe(first));
    cleanups.push(getCurrentImUnreadObserver().subscribe(second));
    expect(first).toHaveBeenLastCalledWith(4);
    expect(second).toHaveBeenLastCalledWith(4);
    expect(state.conversations.size).toBe(1);
    expect(state.channels.size).toBe(1);
    expect(state.refreshed.size).toBe(1);
    expect(state.registeredEvents).toEqual(['conversation-list-refreshed']);
  });

  it('updates on channel-info-only changes without a message or page mount', () => {
    const listener = vi.fn();
    cleanups.push(getCurrentImUnreadObserver().subscribe(listener));
    state.count = 1;
    state.channels.forEach((changed) => changed());
    expect(listener).toHaveBeenLastCalledWith(1);
  });

  it('updates on conversations and complete list refreshes', () => {
    const listener = vi.fn();
    cleanups.push(getCurrentImUnreadObserver().subscribe(listener));
    state.count = 2;
    state.conversations.forEach((changed) => changed());
    expect(listener).toHaveBeenLastCalledWith(2);
    state.count = 0;
    state.refreshed.forEach((changed) => changed());
    expect(listener).toHaveBeenLastCalledWith(0);
  });

  it('removes every upstream listener after the final observer leaves', () => {
    const off = getCurrentImUnreadObserver().subscribe(vi.fn());
    off();
    off();
    expect(state.conversations.size).toBe(0);
    expect(state.channels.size).toBe(0);
    expect(state.refreshed.size).toBe(0);
  });

  it('rolls back a partial registration and can be subscribed again', () => {
    state.failRegistration = true;
    expect(() => getCurrentImUnreadObserver().subscribe(vi.fn())).toThrow('event bus unavailable');
    expect(state.conversations.size).toBe(0);
    expect(state.channels.size).toBe(0);
    state.failRegistration = false;
    cleanups.push(getCurrentImUnreadObserver().subscribe(vi.fn()));
    expect(state.conversations.size).toBe(1);
    expect(state.channels.size).toBe(1);
  });

  it('continues cleanup if one event source throws while being removed', () => {
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const off = getCurrentImUnreadObserver().subscribe(vi.fn());
    state.failChannelCleanup = true;
    off();
    expect(state.conversations.size).toBe(0);
    expect(state.channels.size).toBe(0);
    expect(state.refreshed.size).toBe(0);
    expect(reportError).toHaveBeenCalledOnce();
    off();
    expect(reportError).toHaveBeenCalledOnce();
  });
});
