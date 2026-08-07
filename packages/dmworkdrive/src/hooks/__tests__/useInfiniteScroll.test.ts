import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '../../__tests__/harness';
import { useInfiniteScroll } from '../useInfiniteScroll';

// Capture the observer's callback so tests can trigger intersections
// manually — jsdom doesn't run a real layout engine.
type Cb = (entries: IntersectionObserverEntry[]) => void;
interface CapturedObserver {
  cb: Cb;
  observedEl: HTMLElement | null;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
}
let observers: CapturedObserver[];
let originalIO: typeof IntersectionObserver | undefined;

beforeEach(() => {
  observers = [];
  originalIO = (globalThis as unknown as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  // Constructor-shaped stub — vi.fn() alone is not `new`-able.
  function FakeIO(cb: Cb) {
    const entry: CapturedObserver = {
      cb,
      observedEl: null,
      disconnect: vi.fn(),
      observe: vi.fn((el: HTMLElement) => {
        entry.observedEl = el;
      }),
      unobserve: vi.fn(),
    };
    observers.push(entry);
    return entry as unknown as IntersectionObserver;
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    FakeIO as unknown;
});

afterEach(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = originalIO as unknown;
});

function fakeEntry(isIntersecting: boolean): IntersectionObserverEntry {
  return { isIntersecting } as IntersectionObserverEntry;
}

/**
 * Attach an element to the returned sentinel ref BEFORE the effect runs.
 * Used with rerender() so the second render's useEffect sees the attached
 * element — the whole reason the earlier tests silently passed was that
 * the ref was still null when the effect ran, so `sentinelRef.current`
 * check bailed and no observer was ever created.
 */
function attachEl(
  ref: React.MutableRefObject<HTMLElement | null>,
): HTMLElement {
  const el = document.createElement('div');
  ref.current = el;
  return el;
}

describe('useInfiniteScroll', () => {
  it('does not create an observer when hasMore is false', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ hasMore }: { hasMore: boolean }) =>
        useInfiniteScroll({ hasMore, loading: false, onLoadMore }),
      { hasMore: false },
    );
    attachEl(result.current as React.MutableRefObject<HTMLElement | null>);
    rerender({ hasMore: false });
    // Firm: with hasMore=false and an attached sentinel, still zero
    // observers were created.
    expect(observers).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('creates exactly one observer when hasMore = true and the sentinel is attached', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ hasMore }: { hasMore: boolean }) =>
        useInfiniteScroll({ hasMore, loading: false, onLoadMore }),
      { hasMore: false },
    );
    const el = attachEl(result.current as React.MutableRefObject<HTMLElement | null>);
    rerender({ hasMore: true });
    // Firm: exactly one observer created, observing the attached element.
    expect(observers).toHaveLength(1);
    expect(observers[0].observedEl).toBe(el);
  });

  it('fires onLoadMore when the sentinel intersects', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ hasMore }: { hasMore: boolean }) =>
        useInfiniteScroll({ hasMore, loading: false, onLoadMore }),
      { hasMore: false },
    );
    attachEl(result.current as React.MutableRefObject<HTMLElement | null>);
    rerender({ hasMore: true });
    // Firm: an observer must exist by now (asserted in the previous test);
    // without a fallback guard, so the test will fail loudly if the hook
    // ever regresses to not-creating an observer here.
    expect(observers).toHaveLength(1);
    act(() => {
      observers[0].cb([fakeEntry(true)]);
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not fire onLoadMore for a non-intersecting entry', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ hasMore }: { hasMore: boolean }) =>
        useInfiniteScroll({ hasMore, loading: false, onLoadMore }),
      { hasMore: false },
    );
    attachEl(result.current as React.MutableRefObject<HTMLElement | null>);
    rerender({ hasMore: true });
    expect(observers).toHaveLength(1);
    act(() => {
      observers[0].cb([fakeEntry(false)]);
    });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('disconnects the observer on unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ hasMore }: { hasMore: boolean }) =>
        useInfiniteScroll({ hasMore, loading: false, onLoadMore: () => {} }),
      { hasMore: false },
    );
    attachEl(result.current as React.MutableRefObject<HTMLElement | null>);
    rerender({ hasMore: true });
    expect(observers).toHaveLength(1);
    unmount();
    // Firm: disconnect MUST fire on unmount.
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('tears down and rebuilds when loading flips true then false', () => {
    // Regression for the retry-loop bug: the observer teardown/rebuild
    // cycle when loading flips is exactly what re-arms onLoadMore against
    // a still-intersecting sentinel. This test verifies the cycle happens
    // and, coupled with the loadMoreError latch tested in useFileList, is
    // WHY that latch is required.
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ hasMore, loading }: { hasMore: boolean; loading: boolean }) =>
        useInfiniteScroll({ hasMore, loading, onLoadMore }),
      { hasMore: false, loading: false },
    );
    attachEl(result.current as React.MutableRefObject<HTMLElement | null>);

    // Turn on: one observer.
    rerender({ hasMore: true, loading: false });
    expect(observers).toHaveLength(1);
    const firstDisconnect = observers[0].disconnect;

    // Flip loading -> teardown, no new observer (loading gate).
    rerender({ hasMore: true, loading: true });
    expect(firstDisconnect).toHaveBeenCalledTimes(1);
    expect(observers).toHaveLength(1);

    // Flip loading back -> a brand-new observer is created (rebuild).
    rerender({ hasMore: true, loading: false });
    expect(observers).toHaveLength(2);
    // The two observers are distinct instances (different disconnect fns).
    expect(observers[1].disconnect).not.toBe(observers[0].disconnect);
  });

  it('does not create an observer when hasMore is true but loading is true', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) =>
        useInfiniteScroll({ hasMore: true, loading, onLoadMore }),
      { loading: true },
    );
    attachEl(result.current as React.MutableRefObject<HTMLElement | null>);
    // First render (loading=true) skipped observer creation entirely.
    // Rerender with loading=true again — same deps, same effect state,
    // still no observer.
    rerender({ loading: true });
    expect(observers).toHaveLength(0);

    // Flip loading true -> false: NOW an observer must be created
    // (this is the exact rebuild that also happens after a failed
    // loadMore's loadingMore flips back down, and is why
    // loadMoreError must gate the sentinel — see the retry-loop test
    // in useFileList).
    rerender({ loading: false });
    expect(observers).toHaveLength(1);
  });
});
