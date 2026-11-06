import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useNameSearch from "../useNameSearch";
import type {
  NameSearchPage,
  NameSearchQuery,
} from "../../../Service/NameSearchTypes";

function page(id: string, revision = id, more = false): NameSearchPage {
  return {
    items: [
      {
        id,
        kind: "contact",
        contactType: "human",
        originalName: id,
        remarkName: "",
        displayName: id,
        matches: { original: [], remark: [] },
      },
    ],
    nextCursor: more ? "next" : "",
    hasMore: more,
    complete: true,
    total: more ? 2 : 1,
    incompleteReasons: [],
    resultRevision: revision,
    rulesVersion: "s14-v1",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
type Fetch = (
  query: NameSearchQuery,
  signal?: AbortSignal
) => Promise<NameSearchPage>;
let latest: ReturnType<typeof useNameSearch>;
function Harness({
  query,
  fetch,
}: {
  query: NameSearchQuery | null;
  fetch: Fetch;
}) {
  latest = useNameSearch({ userId: "user", kind: "contact", query, fetch });
  return null;
}
const query = (
  keyword: string,
  spaceId: string | null = "A"
): NameSearchQuery => ({ keyword, spaceId, entry: "global" });

describe("useNameSearch", () => {
  let node: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    node = document.createElement("div");
    document.body.appendChild(node);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(node);
    });
    node.remove();
    vi.useRealTimers();
  });
  const render = (q: NameSearchQuery | null, fetch: Fetch) =>
    act(() => {
      ReactDOM.render(<Harness query={q} fetch={fetch} />, node);
    });
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("does not query empty input or restore results after clearing", async () => {
    const pending = deferred<NameSearchPage>();
    const fetch = vi.fn(() => pending.promise);
    render(query(""), fetch);
    expect(fetch).not.toHaveBeenCalled();
    render(query("向"), fetch);
    render(query(""), fetch);
    pending.resolve(page("old"));
    await flush();
    expect(latest.items).toEqual([]);
    expect(latest.total).toBeNull();
  });
  it("invalidates in-flight responses when archived eligibility changes", async () => {
    const old = deferred<NameSearchPage>(),
      fresh = deferred<NameSearchPage>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    render(
      { ...query("向"), scope: "summary_source", includeArchived: false },
      fetch
    );
    render(
      { ...query("向"), scope: "summary_source", includeArchived: true },
      fetch
    );
    fresh.resolve(page("with-archived"));
    await flush();
    old.resolve(page("active-only"));
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["with-archived"]);
  });
  it("ignores old success and errors after changing keyword or Space", async () => {
    const old = deferred<NameSearchPage>();
    const fresh = deferred<NameSearchPage>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    render(query("向"), fetch);
    render(query("王", "B"), fetch);
    fresh.resolve(page("new"));
    await flush();
    old.reject(new Error("old failure"));
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["new"]);
    expect(latest.error).toBeNull();
  });
  it("retains successful pages on load-more failure and retries the same cursor", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("first", "rev", true))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page("second", "rev"));
    render(query("向"), fetch);
    await flush();
    act(() => {
      void latest.loadMore();
    });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["first"]);
    expect(latest.loadMoreError).toBeInstanceOf(Error);
    act(() => {
      void latest.loadMore();
    });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["first", "second"]);
    expect(fetch.mock.calls[1][0].cursor).toBe("next");
    expect(fetch.mock.calls[2][0].cursor).toBe("next");
  });
  it.each([
    { code: "err.server.search.name_forbidden", status: 400 },
    { status: 403 },
    { status: 401 },
  ])("clears successful pages on known permission loss: %j", async (error) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("private", "rev", true))
      .mockRejectedValueOnce(error);
    render(query("向"), fetch);
    await flush();
    act(() => {
      void latest.loadMore();
    });
    await flush();
    expect(latest.items).toEqual([]);
    expect(latest.total).toBeNull();
    expect(latest.nextCursor).toBe("");
    expect(latest.complete).toBe(false);
    expect(latest.error).toBe(error);
  });
  it("restarts instead of appending when the backend reports query_changed", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("old", "old", true))
      .mockRejectedValueOnce({ code: "err.server.search.query_changed" })
      .mockResolvedValueOnce(page("fresh"));
    render(query("向"), fetch);
    await flush();
    act(() => {
      void latest.loadMore();
    });
    await flush();
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["fresh"]);
    expect(fetch.mock.calls[2][0].cursor).toBe("");
  });
  it("revalidates an active query without discarding loaded pages if unchanged", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("first", "rev", true))
      .mockResolvedValueOnce(page("second", "rev"))
      .mockResolvedValueOnce(page("first", "rev", true));
    render(query("向"), fetch);
    await flush();
    act(() => {
      void latest.loadMore();
    });
    await flush();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["first", "second"]);
  });

  it("replaces all loaded pages when periodic verification finds a changed revision", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("first", "old", true))
      .mockResolvedValueOnce({ ...page("second", "old"), total: 2 })
      .mockResolvedValueOnce(page("new", "new"));
    render(query("向"), fetch);
    await flush();
    act(() => {
      void latest.loadMore();
    });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["first", "second"]);
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["new"]);
    expect(latest.total).toBe(1);
    expect(latest.nextCursor).toBe("");
  });
  it("rejects duplicate append identities and retains successful pages", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("first", "rev", true))
      .mockResolvedValueOnce(page("first", "rev"));
    render(query("向"), fetch);
    await flush();
    act(() => {
      void latest.loadMore();
    });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(["first"]);
    expect(latest.loadMoreError).toBeInstanceOf(Error);
    expect(latest.nextCursor).toBe("next");
  });
  it("hides unverified results if periodic revalidation fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("first"))
      .mockRejectedValueOnce(new Error("offline"));
    render(query("向"), fetch);
    await flush();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await flush();
    expect(latest.items).toEqual([]);
    expect(latest.total).toBeNull();
    expect(latest.error).toBeInstanceOf(Error);
  });
  it("refreshes on focus and immediately invalidates a known stale query", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("old"))
      .mockResolvedValueOnce(page("new"))
      .mockResolvedValueOnce(page("latest"));
    render(query("向"), fetch);
    await flush();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(latest.items[0].id).toBe("new");
    act(() => {
      latest.invalidate();
    });
    expect(latest.items).toEqual([]);
    await flush();
    expect(latest.items[0].id).toBe("latest");
  });
  it("does not loop if query_changed is returned for a cursorless initial query", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce({ code: "err.server.search.query_changed" })
      .mockResolvedValueOnce(page("unexpected"));
    render(query("向"), fetch);
    await flush();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(latest.error).toMatchObject({
      code: "err.server.search.query_changed",
    });
  });
  it("pauses periodic requests while hidden and rechecks on becoming visible", async () => {
    const fetch = vi.fn().mockResolvedValue(page("first"));
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState"
    );
    try {
      render(query("向"), fetch);
      await flush();
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      await flush();
      expect(fetch).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await flush();
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      if (descriptor)
        Object.defineProperty(document, "visibilityState", descriptor);
      else Reflect.deleteProperty(document, "visibilityState");
    }
  });
});
