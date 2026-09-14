import { describe, expect, it, vi } from 'vitest';
import { createUnreadCountObserver } from './unreadObserver';

function fixture() {
  let count = 3;
  const listeners = new Set<() => void>();
  const cleanup = vi.fn();
  const onError = vi.fn();
  const readCount = vi.fn(() => count);
  const subscribeChanges = vi.fn((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      cleanup();
    };
  });
  return {
    observer: createUnreadCountObserver({ readCount, subscribeChanges, onError }),
    readCount, subscribeChanges, listeners, cleanup, onError,
    setCount(value: number) { count = value; },
    emit() { for (const listener of listeners) listener(); },
  };
}

describe('shared unread observer', () => {
  it('reads a snapshot without starting background listeners', () => {
    const f = fixture();
    expect(f.observer.getSnapshot()).toBe(3);
    expect(f.subscribeChanges).not.toHaveBeenCalled();
  });

  it('subscribes before reading the first snapshot', () => {
    const f = fixture();
    f.subscribeChanges.mockImplementationOnce((listener) => {
      f.setCount(8);
      listener();
      return f.cleanup;
    });
    const listener = vi.fn();
    f.observer.subscribe(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith(8);
  });

  it('shares upstream listeners and provides each subscriber an initial count', () => {
    const f = fixture();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = f.observer.subscribe(first);
    const offSecond = f.observer.subscribe(second);
    expect(first).toHaveBeenLastCalledWith(3);
    expect(second).toHaveBeenLastCalledWith(3);
    expect(f.subscribeChanges).toHaveBeenCalledOnce();
    f.setCount(5);
    f.emit();
    expect(first).toHaveBeenLastCalledWith(5);
    expect(second).toHaveBeenLastCalledWith(5);
    offFirst();
    offFirst();
    expect(f.cleanup).not.toHaveBeenCalled();
    offSecond();
    expect(f.cleanup).toHaveBeenCalledOnce();
    expect(f.listeners.size).toBe(0);
  });

  it('refreshes from the data source after every subscriber has left', () => {
    const f = fixture();
    f.observer.subscribe(vi.fn())();
    f.setCount(12);
    const next = vi.fn();
    f.observer.subscribe(next);
    expect(next).toHaveBeenCalledExactlyOnceWith(12);
    expect(f.subscribeChanges).toHaveBeenCalledTimes(2);
  });

  it('keeps independent subscription handles for the same callback', () => {
    const f = fixture();
    const listener = vi.fn();
    const first = f.observer.subscribe(listener);
    const second = f.observer.subscribe(listener);
    first();
    f.emit();
    expect(f.cleanup).not.toHaveBeenCalled();
    second();
    expect(f.cleanup).toHaveBeenCalledOnce();
  });

  it('isolates a throwing consumer from the other consumers', () => {
    const f = fixture();
    const error = new Error('consumer failed');
    const first = vi.fn(() => { throw error; });
    const second = vi.fn();
    f.observer.subscribe(first);
    f.observer.subscribe(second);
    f.setCount(2);
    f.emit();
    expect(second).toHaveBeenLastCalledWith(2);
    expect(f.onError).toHaveBeenCalledWith(error);
  });

  it('does not turn a failed read into a fabricated zero count', () => {
    const f = fixture();
    const listener = vi.fn();
    f.observer.subscribe(listener);
    f.readCount.mockImplementationOnce(() => { throw new Error('unavailable'); });
    f.emit();
    expect(listener).toHaveBeenCalledExactlyOnceWith(3);
    expect(f.onError).toHaveBeenCalledOnce();
    f.setCount(0);
    f.emit();
    expect(listener).toHaveBeenLastCalledWith(0);
  });

  it('releases upstream subscriptions if its initial read fails', () => {
    const f = fixture();
    f.readCount.mockImplementationOnce(() => { throw new Error('unavailable'); });
    expect(() => f.observer.subscribe(vi.fn())).toThrow('unavailable');
    expect(f.cleanup).toHaveBeenCalledOnce();
    const next = vi.fn();
    f.observer.subscribe(next);
    expect(next).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('does not notify a consumer removed by another callback', () => {
    const f = fixture();
    let offSecond = () => {};
    let active = false;
    f.observer.subscribe(() => { if (active) offSecond(); });
    const second = vi.fn();
    offSecond = f.observer.subscribe(second);
    active = true;
    f.emit();
    expect(second).toHaveBeenCalledOnce();
  });

  it('does not publish an older count after a consumer synchronously changes the source', () => {
    const f = fixture();
    f.observer.subscribe((count) => {
      if (count === 5) {
        f.setCount(0);
        f.emit();
      }
    });
    const second = vi.fn();
    f.observer.subscribe(second);
    f.setCount(5);
    f.emit();

    expect(second.mock.calls.map(([count]) => count)).toEqual([3, 0]);
    expect(f.observer.getSnapshot()).toBe(0);
  });

  it('ignores an upstream event already queued after cleanup', () => {
    const f = fixture();
    const listener = vi.fn();
    const off = f.observer.subscribe(listener);
    const queued = f.subscribeChanges.mock.calls[0][0];
    off();
    queued();
    expect(listener).toHaveBeenCalledOnce();
  });
});
