import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import { useDocumentSearch } from "./useDocumentSearch";

const documentItem = (docId: string) => ({
  docId,
  title: docId,
  docType: "doc" as const,
  updatedAt: 1770000000000,
});

describe("useDocumentSearch", () => {
  const apiGet = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    (WKApp.apiClient as { get: typeof apiGet }).get = apiGet;
    apiGet.mockResolvedValue({ total: 0, items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    apiGet.mockReset();
    vi.restoreAllMocks();
  });

  it("loads recent documents by default after opening", async () => {
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    act(() => vi.advanceTimersByTime(249));
    expect(apiGet).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(apiGet).toHaveBeenCalledWith("docs/recent", {
      param: { pageSize: 50, type: ["doc", "html"] },
    });
  });

  it("debounces keyword search with the docs list q parameter", async () => {
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );
    await act(async () => vi.advanceTimersByTime(250));
    apiGet.mockClear();

    act(() => result.current.actions.onKeywordChange("项目"));
    act(() => vi.advanceTimersByTime(249));
    expect(apiGet).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(apiGet).toHaveBeenCalledWith("docs/recent", {
      param: { pageSize: 50, type: ["doc", "html"], q: "项目" },
    });
  });

  it("loads my documents when the source changes", async () => {
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );
    await act(async () => vi.advanceTimersByTime(250));
    apiGet.mockClear();

    act(() => result.current.actions.onSourceChange("mine"));
    await act(async () => vi.advanceTimersByTime(250));

    expect(result.current.state.source).toBe("mine");
    expect(apiGet).toHaveBeenCalledWith("docs", {
      param: {
        owner: "me",
        page: 1,
        pageSize: 50,
        sort: "updatedAt:desc",
        type: ["doc", "html"],
      },
    });
  });

  it("does not enter loading or refetch when the active source is clicked", async () => {
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );
    await act(async () => vi.advanceTimersByTime(250));
    apiGet.mockClear();

    act(() => result.current.actions.onSourceChange("recent"));
    expect(result.current.state.isLoading).toBe(false);
    await act(async () => vi.advanceTimersByTime(250));
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("does not let an older response overwrite a newer query", async () => {
    let resolveOld!: (value: any) => void;
    let resolveNew!: (value: any) => void;
    apiGet
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNew = resolve;
        })
      );
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    await act(async () => vi.advanceTimersByTime(250));
    act(() => result.current.actions.onKeywordChange("新"));
    await act(async () => vi.advanceTimersByTime(250));
    await act(async () =>
      resolveNew({ total: 1, items: [documentItem("new")] })
    );
    expect(result.current.state.items).toEqual([documentItem("new")]);

    await act(async () =>
      resolveOld({ total: 1, items: [documentItem("old")] })
    );
    expect(result.current.state.items).toEqual([documentItem("new")]);
  });

  it("retries the current query after an error", async () => {
    apiGet
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ total: 1, items: [documentItem("retry")] });
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.error).toBeTruthy();

    act(() => result.current.actions.onRetry());
    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.items).toEqual([documentItem("retry")]);
  });

  it("clears stale errors and enters loading synchronously on keyword change", async () => {
    apiGet.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.error).toBeTruthy();
    expect(result.current.state.isLoading).toBe(false);

    act(() => result.current.actions.onKeywordChange("新关键词"));
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.isLoading).toBe(true);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it("ignores an in-flight response after close", async () => {
    let resolve!: (value: any) => void;
    apiGet.mockReturnValueOnce(
      new Promise((next) => {
        resolve = next;
      })
    );
    const { result, rerender } = renderHook(
      ({ visible }) =>
        useDocumentSearch({ visible, selected: [], maxSelect: 10 }),
      { initialProps: { visible: true } }
    );

    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.isLoading).toBe(true);
    rerender({ visible: false });
    await act(async () => resolve({ total: 1, items: [documentItem("late")] }));

    expect(result.current.state.items).toEqual([]);
    expect(result.current.state.isLoading).toBe(false);
  });

  it("clears loading, results, and keyword across close and reopen", async () => {
    apiGet.mockResolvedValueOnce({
      total: 1,
      items: [documentItem("doc-1")],
    });
    const { result, rerender } = renderHook(
      ({ visible }) =>
        useDocumentSearch({ visible, selected: [], maxSelect: 10 }),
      { initialProps: { visible: true } }
    );
    act(() => result.current.actions.onKeywordChange("项目"));
    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.items).toHaveLength(1);

    rerender({ visible: false });
    expect(result.current.state.keyword).toBe("");
    expect(result.current.state.source).toBe("recent");
    expect(result.current.state.items).toEqual([]);
    expect(result.current.state.isLoading).toBe(false);

    rerender({ visible: true });
    expect(result.current.state.keyword).toBe("");
    expect(result.current.state.source).toBe("recent");
    expect(result.current.state.isLoading).toBe(true);
  });

  it("exposes hasMore from the recent cursor, not total", async () => {
    apiGet.mockResolvedValueOnce({
      nextCursor: "next",
      items: [documentItem("doc-1")],
    });
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    await act(async () => vi.advanceTimersByTime(250));

    expect(result.current.state.items).toHaveLength(1);
    expect(result.current.state.hasMore).toBe(true);
  });

  it("loads the next recent page once, deduplicates rows and keeps selection", async () => {
    apiGet
      .mockResolvedValueOnce({
        items: [documentItem("a")],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: [documentItem("a"), documentItem("b")],
        nextCursor: null,
      });
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );
    await act(async () => vi.advanceTimersByTime(250));
    act(() => result.current.actions.onToggle(documentItem("a")));
    await act(async () => {
      void result.current.actions.onLoadMore();
      void result.current.actions.onLoadMore();
    });
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet).toHaveBeenLastCalledWith("docs/recent", {
      param: { pageSize: 50, type: ["doc", "html"], cursor: "page-2" },
    });
    expect(result.current.state.items.map((item) => item.docId)).toEqual([
      "a",
      "b",
    ]);
    expect(result.current.state.selected).toEqual([documentItem("a")]);
    expect(result.current.state.hasMore).toBe(false);
    await act(async () => result.current.actions.onLoadMore());
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it("retries the same failed page without losing items or selection", async () => {
    apiGet
      .mockResolvedValueOnce({
        items: [documentItem("a")],
        nextCursor: "page-2",
      })
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ items: [documentItem("b")], nextCursor: null });
    const { result } = renderHook(() =>
      useDocumentSearch({
        visible: true,
        selected: [documentItem("a")],
        maxSelect: 10,
      })
    );
    await act(async () => vi.advanceTimersByTime(250));
    await act(async () => result.current.actions.onLoadMore());
    expect(result.current.state.items).toEqual([documentItem("a")]);
    expect(result.current.state.selected).toEqual([documentItem("a")]);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.loadMoreError).toBeTruthy();
    expect(result.current.state.isLoadingMore).toBe(false);
    await act(async () => result.current.actions.onLoadMore());
    expect(apiGet.mock.calls[1]).toEqual(apiGet.mock.calls[2]);
    expect(result.current.state.items).toHaveLength(2);
    expect(result.current.state.loadMoreError).toBeNull();
  });

  it.each(["keyword", "tab", "close"] as const)(
    "ignores pending pagination after %s changes",
    async (change) => {
      let resolvePage!: (value: unknown) => void;
      apiGet
        .mockResolvedValueOnce({
          items: [documentItem("a")],
          nextCursor: "page-2",
        })
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolvePage = resolve;
          })
        )
        .mockResolvedValue({
          items: [documentItem("new")],
          total: 1,
          nextCursor: null,
        });
      const { result, rerender } = renderHook(
        ({ visible }) =>
          useDocumentSearch({ visible, selected: [], maxSelect: 10 }),
        { initialProps: { visible: true } }
      );
      await act(async () => vi.advanceTimersByTime(250));
      act(() => {
        void result.current.actions.onLoadMore();
      });
      expect(result.current.state.isLoadingMore).toBe(true);
      act(() => {
        if (change === "keyword") result.current.actions.onKeywordChange("new");
        if (change === "tab") result.current.actions.onSourceChange("mine");
        if (change === "close") rerender({ visible: false });
      });
      // Resolve during the next search's debounce, before its request starts.
      await act(async () =>
        resolvePage({ items: [documentItem("late")], nextCursor: "bad" })
      );
      expect(result.current.state.items).not.toContainEqual(
        documentItem("late")
      );
      expect(result.current.state.isLoadingMore).toBe(false);
      expect(result.current.state.hasMore).toBe(false);
      await act(async () => vi.advanceTimersByTime(250));
      if (change !== "close")
        expect(result.current.state.items).toEqual([documentItem("new")]);
      else expect(result.current.state.items).toEqual([]);
    }
  );

  it("increments mine pages and resets to page one on a new keyword", async () => {
    apiGet.mockResolvedValue({ items: [documentItem("a")], total: 51 });
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );
    act(() => result.current.actions.onSourceChange("mine"));
    await act(async () => vi.advanceTimersByTime(250));
    await act(async () => result.current.actions.onLoadMore());
    expect(apiGet.mock.lastCall?.[1].param.page).toBe(2);
    expect(result.current.state.hasMore).toBe(false);
    act(() => result.current.actions.onKeywordChange("new"));
    await act(async () => vi.advanceTimersByTime(250));
    expect(apiGet.mock.lastCall?.[1].param).toMatchObject({
      page: 1,
      q: "new",
    });
    expect(result.current.state.items).toHaveLength(1);
  });

  it("filters unsupported document kinds from list results", async () => {
    apiGet.mockResolvedValueOnce({
      total: 3,
      items: [
        { ...documentItem("doc-1"), updatedAt: "2026-09-17T01:02:03.000Z" },
        { ...documentItem("sheet-1"), docType: "sheet" },
        { ...documentItem("html-1"), docType: "html" },
      ],
    });
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    await act(async () => vi.advanceTimersByTime(250));

    expect(result.current.state.items).toEqual([
      {
        docId: "doc-1",
        title: "doc-1",
        docType: "doc",
        updatedAt: Date.parse("2026-09-17T01:02:03.000Z"),
        spaceId: undefined,
      },
      {
        docId: "html-1",
        title: "html-1",
        docType: "html",
        updatedAt: 1770000000000,
        spaceId: undefined,
      },
    ]);
  });
});
