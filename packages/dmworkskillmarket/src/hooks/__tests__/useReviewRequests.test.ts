import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PagedResult, ReviewRequest } from "../../types/skill";
import * as api from "../../api/skillApi";
import { useReviewRequests } from "../useReviewRequests";

vi.mock("../../api/skillApi");

const pendingRequest: ReviewRequest = {
  id: "rev-1",
  pluginId: "plugin-1",
  pluginName: "CI 失败分析",
  pluginType: "skill",
  spaceId: "dev-space",
  targetScope: "space",
  status: "pending",
  kind: "first",
  version: "0.1.0",
  applicantId: "u-1",
  applicantName: "Jian",
  submittedAt: "2026-08-31T10:00:00Z",
};

function page(
  items: ReviewRequest[],
  total = items.length
): PagedResult<ReviewRequest> {
  return { items, nextCursor: null, total };
}

beforeEach(() => {
  vi.mocked(api.listReviewRequests).mockResolvedValue(page([pendingRequest]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useReviewRequests", () => {
  it("loads the first page and reports the pending count from it", async () => {
    const { result } = renderHook(() =>
      useReviewRequests({ mode: "space", status: "pending" })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toEqual([pendingRequest]);
    expect(result.current.total).toBe(1);
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
    expect(api.listReviewRequests).toHaveBeenCalledWith(
      "space",
      expect.objectContaining({ status: "pending", page: 1, pageSize: 20 })
    );
    // status=pending already IS the pending set — no extra badge probe.
    expect(api.listReviewRequests).toHaveBeenCalledTimes(1);
  });

  it("issues a separate page_size=1 badge probe when not filtering pending", async () => {
    vi.mocked(api.listReviewRequests)
      .mockResolvedValueOnce(page([{ ...pendingRequest, status: "approved" }]))
      .mockResolvedValueOnce(page([], 4));

    const { result } = renderHook(() => useReviewRequests({ mode: "space" }));

    await waitFor(() => expect(result.current.pendingCount).toBe(4));
    expect(api.listReviewRequests).toHaveBeenNthCalledWith(
      2,
      "space",
      expect.objectContaining({ status: "pending", pageSize: 1 })
    );
  });

  it("gives the badge probe the same abort signal as the page read", async () => {
    vi.mocked(api.listReviewRequests)
      .mockResolvedValueOnce(page([{ ...pendingRequest, status: "approved" }]))
      .mockResolvedValueOnce(page([], 4));

    const { result } = renderHook(() => useReviewRequests({ mode: "space" }));

    await waitFor(() => expect(result.current.pendingCount).toBe(4));
    const calls = vi.mocked(api.listReviewRequests).mock.calls;
    expect(calls[1][1]?.signal).toBe(calls[0][1]?.signal);
  });

  it("refetches when a primitive filter changes", async () => {
    const { result, rerender } = renderHook(
      ({ status }: { status?: "pending" | "approved" }) =>
        useReviewRequests({ mode: "mine", status }),
      {
        initialProps: {
          status: "pending" as "pending" | "approved" | undefined,
        },
      }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.listReviewRequests).toHaveBeenCalledTimes(1);

    rerender({ status: "approved" });

    await waitFor(() =>
      expect(api.listReviewRequests).toHaveBeenCalledWith(
        "mine",
        expect.objectContaining({ status: "approved" })
      )
    );
  });

  it("does not refetch when only the identity of the options object changes", async () => {
    const { result, rerender } = renderHook(() =>
      useReviewRequests({ mode: "mine", status: "pending", pageSize: 20 })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsAfterLoad = vi.mocked(api.listReviewRequests).mock.calls.length;

    rerender();
    rerender();

    expect(vi.mocked(api.listReviewRequests).mock.calls.length).toBe(
      callsAfterLoad
    );
  });

  it("aborts the in-flight request on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useReviewRequests({ mode: "mine", status: "pending" })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    const signal = vi.mocked(api.listReviewRequests).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("swallows AbortError instead of surfacing it as an error", async () => {
    vi.mocked(api.listReviewRequests).mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError")
    );

    const { result } = renderHook(() =>
      useReviewRequests({ mode: "mine", status: "pending" })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("surfaces a real failure as a string error", async () => {
    vi.mocked(api.listReviewRequests).mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useReviewRequests({ mode: "space", status: "pending" })
    );

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.items).toEqual([]);
  });

  it("skips the request entirely while disabled", async () => {
    const { result } = renderHook(() =>
      useReviewRequests({ mode: "space", status: "pending", enabled: false })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.listReviewRequests).not.toHaveBeenCalled();
    expect(result.current.pendingCount).toBe(0);
  });

  it("aborts the in-flight request when enabled flips true → false", async () => {
    // Regression: the disabled branch used to clear state WITHOUT aborting, so
    // a response still in flight for the previous Space landed afterwards and
    // repopulated the queue the gate had just emptied.
    let resolveFirst: ((value: PagedResult<ReviewRequest>) => void) | undefined;
    vi.mocked(api.listReviewRequests).mockImplementationOnce(
      () =>
        new Promise<PagedResult<ReviewRequest>>((resolve) => {
          resolveFirst = resolve;
        })
    );

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useReviewRequests({ mode: "space", status: "pending", enabled }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() =>
      expect(api.listReviewRequests).toHaveBeenCalledTimes(1)
    );
    const signal = vi.mocked(api.listReviewRequests).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    rerender({ enabled: false });

    expect(signal?.aborted).toBe(true);

    // The stale response lands after the gate closed; it must not resurrect
    // the cleared state.
    await act(async () => {
      resolveFirst?.(page([pendingRequest]));
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it("appends the next page on loadMore and stops when the cursor runs out", async () => {
    const second = { ...pendingRequest, id: "rev-2" };
    vi.mocked(api.listReviewRequests)
      .mockResolvedValueOnce({
        items: [pendingRequest],
        nextCursor: "2",
        total: 2,
      })
      .mockResolvedValueOnce({ items: [second], nextCursor: null, total: 2 });

    const { result } = renderHook(() =>
      useReviewRequests({ mode: "space", status: "pending", pageSize: 1 })
    );

    await waitFor(() => expect(result.current.hasMore).toBe(true));

    result.current.loadMore();

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    expect(api.listReviewRequests).toHaveBeenNthCalledWith(
      2,
      "space",
      expect.objectContaining({ page: 2 })
    );
  });
});
