import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchService } from "@octo/base";
import { useDocumentSearch } from "./useDocumentSearch";

const documentItem = (docId: string) => ({
  docId,
  title: docId,
  docType: "doc" as const,
  updatedAt: 1,
});

describe("useDocumentSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(SearchService, "searchDocs").mockResolvedValue({ total: 0, items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces searches for 250ms", async () => {
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    act(() => result.current.actions.onKeywordChange("项目"));
    act(() => vi.advanceTimersByTime(249));
    expect(SearchService.searchDocs).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(SearchService.searchDocs).toHaveBeenCalledWith({ keyword: "项目", pageSize: 50 });
  });

  it("does not let an older response overwrite a newer query", async () => {
    let resolveOld!: (value: any) => void;
    let resolveNew!: (value: any) => void;
    vi.mocked(SearchService.searchDocs)
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    act(() => result.current.actions.onKeywordChange("旧"));
    await act(async () => vi.advanceTimersByTime(250));
    act(() => result.current.actions.onKeywordChange("新"));
    await act(async () => vi.advanceTimersByTime(250));
    await act(async () => resolveNew({ total: 1, items: [documentItem("new")] }));
    expect(result.current.state.items).toEqual([documentItem("new")]);

    await act(async () => resolveOld({ total: 1, items: [documentItem("old")] }));
    expect(result.current.state.items).toEqual([documentItem("new")]);
  });

  it("retries the current query after an error", async () => {
    vi.mocked(SearchService.searchDocs)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ total: 1, items: [documentItem("retry")] });
    const { result } = renderHook(() =>
      useDocumentSearch({ visible: true, selected: [], maxSelect: 10 })
    );

    act(() => result.current.actions.onKeywordChange("项目"));
    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.error).toBeTruthy();

    act(() => result.current.actions.onRetry());
    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.items).toEqual([documentItem("retry")]);
  });

  it("clears loading, results, and keyword across close and reopen", async () => {
    vi.mocked(SearchService.searchDocs).mockResolvedValueOnce({
      total: 1,
      items: [documentItem("doc-1")],
    });
    const { result, rerender } = renderHook(
      ({ visible }) => useDocumentSearch({ visible, selected: [], maxSelect: 10 }),
      { initialProps: { visible: true } }
    );
    act(() => result.current.actions.onKeywordChange("项目"));
    await act(async () => vi.advanceTimersByTime(250));
    expect(result.current.state.items).toHaveLength(1);

    rerender({ visible: false });
    expect(result.current.state.keyword).toBe("");
    expect(result.current.state.items).toEqual([]);
    expect(result.current.state.isLoading).toBe(false);

    rerender({ visible: true });
    expect(result.current.state.keyword).toBe("");
    expect(result.current.state.items).toEqual([]);
    expect(result.current.state.isLoading).toBe(false);
  });
});
