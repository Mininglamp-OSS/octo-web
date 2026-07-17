// @vitest-environment jsdom
import React, { useCallback } from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useSearchPagination from "../useSearchPagination";

interface Item {
  id: string;
}

interface HarnessProps {
  enabled: boolean;
  query: string;
  request: (
    query: string,
    cursor?: string
  ) => Promise<{
    items: Item[];
    nextCursor?: string;
    hasMore: boolean;
  }>;
}

let latest: ReturnType<typeof useSearchPagination<Item>>;

function Harness({ enabled, query, request }: HarnessProps) {
  const search = useCallback(
    (cursor?: string) => request(query, cursor),
    [query, request]
  );
  latest = useSearchPagination({
    enabled,
    search,
    errorMessage: "failed",
  });
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useSearchPagination", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    vi.useRealTimers();
  });

  it("does not request while disabled", async () => {
    const request = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    act(() => {
      ReactDOM.render(
        <Harness enabled={false} query="hidden" request={request} />,
        container
      );
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await act(flush);

    expect(request).not.toHaveBeenCalled();
    expect(latest.queryStarted).toBe(false);
  });

  it("ignores an older query that resolves after the input changes", async () => {
    const first = deferred<{ items: Item[]; hasMore: boolean }>();
    const second = deferred<{ items: Item[]; hasMore: boolean }>();
    const request = vi.fn((query: string) =>
      query === "first" ? first.promise : second.promise
    );

    act(() => {
      ReactDOM.render(
        <Harness enabled query="first" request={request} />,
        container
      );
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(request).toHaveBeenCalledWith("first", undefined);

    act(() => {
      ReactDOM.render(
        <Harness enabled query="second" request={request} />,
        container
      );
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(request).toHaveBeenCalledWith("second", undefined);

    await act(async () => {
      first.resolve({ items: [{ id: "old" }], hasMore: false });
      await flush();
    });
    expect(latest.response.items).toEqual([]);

    await act(async () => {
      second.resolve({ items: [{ id: "new" }], hasMore: false });
      await flush();
    });
    expect(latest.response.items).toEqual([{ id: "new" }]);
  });
});
