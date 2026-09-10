import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import ReviewQueue from "../ReviewQueue";
import * as api from "../../api/skillApi";
import type { PagedResult, ReviewRequest } from "../../types/skill";

vi.mock("../../api/skillApi");

function request(id = "a", status: ReviewRequest["status"] = "pending"): ReviewRequest {
  return {
    id, pluginId: id, pluginName: id, pluginType: "skill", spaceId: "space-a", targetScope: "space",
    status, kind: "first", version: "1.0.0", applicantId: "test-uid", applicantName: "Applicant",
    submittedAt: "2026-09-01T00:00:00Z", pluginListingState: "published",
  };
}
const page = (items: ReviewRequest[], nextCursor: string | null = null): PagedResult<ReviewRequest> => ({ items, nextCursor, total: items.length });
const approve = (id = "a") => screen.getByRole("button", { name: `通过「${id}」的上架申请` });
const cancel = () => screen.getByRole("button", { name: "取消「a」的审核申请" });
const retry = () => screen.getByRole("button", { name: "重试", exact: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function pause() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
}
function switchSpace() {
  act(() => {
    WKApp.shared.currentSpaceId = WKApp.shared.currentSpaceId === "space-a" ? "space-b" : "space-a";
    WKApp.mittBus.emit("space-changed");
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  WKApp.shared.currentSpaceId = "space-a";
  vi.mocked(api.listReviewRequests).mockResolvedValue(page([request(), request("b")]));
  vi.mocked(api.approveReview).mockResolvedValue(undefined);
  vi.mocked(api.cancelReview).mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("ReviewQueue mutation ownership and durable errors", () => {
  it.each(["approve", "cancel"] as const)("keeps a failed %s banner through delayed reconciliation", async (action) => {
    const write = deferred<void>();
    const refresh = deferred<PagedResult<ReviewRequest>>();
    vi.mocked(action === "approve" ? api.approveReview : api.cancelReview).mockReturnValue(write.promise);
    vi.mocked(api.listReviewRequests).mockResolvedValueOnce(page([request()])).mockReturnValueOnce(refresh.promise);
    const { container } = render(<ReviewQueue mode={action === "approve" ? "space" : "mine"} />);
    await screen.findByText("a", { exact: true });
    fireEvent.click(action === "approve" ? approve() : cancel());
    await act(async () => { write.reject(new Error("Decision failed (409)")); });
    expect(container.querySelector(".skill-market-review-queue__error")).toHaveTextContent("Decision failed (409)");
    expect(screen.getByText("a", { exact: true })).toBeInTheDocument();
    expect(action === "approve" ? approve() : cancel()).toBeDisabled();
    await act(async () => { refresh.resolve(page([])); });
    expect(container.querySelector(".skill-market-review-queue__error")).toHaveTextContent("Decision failed (409)");
    expect(screen.queryByText("a", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.listReviewRequests).toHaveBeenCalledTimes(2);
  });

  it("keeps the failed delist message in the queue and reason dialog after reconciliation", async () => {
    vi.mocked(api.listReviewRequests).mockImplementation(async (_mode, params) => page(params?.status === "approved" ? [request("a", "approved")] : []));
    vi.mocked(api.delistPlugin).mockRejectedValue(new Error("Delist failed (409)"));
    const { container } = render(<ReviewQueue mode="space" />);
    fireEvent.click(screen.getByRole("tab", { name: "已处理" }));
    await screen.findByText("a", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "下架「a」" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "reason" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "下架", exact: true }));
    expect(await within(dialog).findByText("Delist failed (409)")).toBeInTheDocument();
    expect(container.querySelector(".skill-market-review-queue__error")).toHaveTextContent("Delist failed (409)");
    expect(within(dialog).getByRole("textbox")).toHaveValue("reason");
  });

  it("locks every row synchronously until the owning write and refresh finish", async () => {
    const write = deferred<void>();
    const refresh = deferred<PagedResult<ReviewRequest>>();
    vi.mocked(api.approveReview).mockReturnValue(write.promise);
    vi.mocked(api.listReviewRequests).mockResolvedValueOnce(page([request(), request("b")])).mockReturnValueOnce(refresh.promise);
    render(<ReviewQueue mode="space" />);
    await screen.findByText("a", { exact: true });
    const a = approve();
    const b = approve("b");
    act(() => { a.click(); b.click(); a.click(); });
    expect(api.approveReview).toHaveBeenCalledTimes(1);
    expect(a).toBeDisabled();
    expect(b).toBeDisabled();
    await act(async () => { write.resolve(); });
    expect(a).toBeDisabled();
    expect(b).toBeDisabled();
    await act(async () => { refresh.resolve(page([request("b")])); });
    expect(approve("b")).toBeEnabled();
  });

  it.each(["success", "failure"] as const)("abandons an old %s after Space A-B-A without unlocking the new action", async (outcome) => {
    const old = deferred<void>();
    const current = deferred<void>();
    vi.mocked(api.approveReview).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<ReviewQueue mode="space" />);
    await screen.findByText("a", { exact: true });
    fireEvent.click(approve());
    switchSpace();
    await screen.findByText("a", { exact: true });
    switchSpace();
    await screen.findByText("a", { exact: true });
    fireEvent.click(approve());
    await act(async () => { if (outcome === "success") old.resolve(); else old.reject(new Error("old failure")); });
    expect(approve()).toBeDisabled();
    expect(screen.queryByText("old failure")).not.toBeInTheDocument();
    expect(api.listReviewRequests).toHaveBeenCalledTimes(3);
    await act(async () => { current.resolve(); });
    expect(api.listReviewRequests).toHaveBeenCalledTimes(4);
  });

  it.each(["success", "failure"] as const)("does not reconcile a write that completes with %s after unmount", async (outcome) => {
    const write = deferred<void>();
    vi.mocked(api.approveReview).mockReturnValue(write.promise);
    const { unmount } = render(<ReviewQueue mode="space" />);
    await screen.findByText("a", { exact: true });
    fireEvent.click(approve());
    unmount();
    await act(async () => { if (outcome === "success") write.resolve(); else write.reject(new Error("old failure")); });
    expect(api.listReviewRequests).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"] as const)("releases its own lock after a silent Space change and stale %s", async (outcome) => {
    const write = deferred<void>();
    vi.mocked(api.approveReview).mockReturnValue(write.promise);
    render(<ReviewQueue mode="space" />);
    await screen.findByText("a", { exact: true });
    fireEvent.click(approve());
    WKApp.shared.currentSpaceId = "space-b";
    await act(async () => { if (outcome === "success") write.resolve(); else write.reject(new Error("old failure")); });
    expect(approve()).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("组织已切换");
    expect(screen.queryByText("old failure")).not.toBeInTheDocument();
    expect(api.listReviewRequests).toHaveBeenCalledTimes(1);
    fireEvent.click(approve());
    expect(api.approveReview).toHaveBeenCalledTimes(1);
  });

  it.each(["before", "success", "failure"] as const)("preserves the reject reason when a silent Space change occurs %s", async (stage) => {
    const write = deferred<void>();
    vi.mocked(api.rejectReview).mockReturnValue(write.promise);
    render(<ReviewQueue mode="space" />);
    await screen.findByText("a", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "拒绝「a」的上架申请" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "retained reason" } });
    if (stage === "before") WKApp.shared.currentSpaceId = "space-b";
    fireEvent.click(within(dialog).getByRole("button", { name: "确认拒绝" }));
    if (stage !== "before") {
      WKApp.shared.currentSpaceId = "space-b";
      await act(async () => { if (stage === "success") write.resolve(); else write.reject(new Error("old reject failure")); });
    }
    expect(await within(dialog).findByText(/组织已切换/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox")).toHaveValue("retained reason");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeEnabled();
    expect(api.rejectReview).toHaveBeenCalledTimes(stage === "before" ? 0 : 1);
    expect(api.listReviewRequests).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains a pending rejection reason when confirm is invoked twice before rerender", async () => {
    const write = deferred<void>();
    vi.mocked(api.rejectReview).mockReturnValue(write.promise);
    render(<ReviewQueue mode="space" />);
    await screen.findByText("a", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "拒绝「a」的上架申请" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "retained reason" } });
    const confirm = within(dialog).getByRole("button", { name: "确认拒绝" });
    act(() => { confirm.click(); confirm.click(); });
    await pause();
    expect(api.rejectReview).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("textbox")).toHaveValue("retained reason");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    await act(async () => { write.reject(new Error("retry later")); });
    expect(await within(dialog).findByText("retry later")).toBeInTheDocument();
  });

  it("waits for the newest handled refresh when an action reconciliation is superseded", async () => {
    const first = deferred<PagedResult<ReviewRequest>>();
    const second = deferred<PagedResult<ReviewRequest>>();
    let approvedReads = 0;
    vi.mocked(api.listReviewRequests).mockImplementation(async (_mode, params) => {
      if (params?.status !== "approved") return page([]);
      approvedReads++;
      if (approvedReads === 2) return first.promise;
      if (approvedReads === 3) return second.promise;
      return page([request("a", "approved")]);
    });
    vi.mocked(api.delistPlugin).mockResolvedValue(undefined);
    render(<ReviewQueue mode="space" />);
    fireEvent.click(screen.getByRole("tab", { name: "已处理" }));
    await screen.findByText("a", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "下架「a」" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "下架", exact: true }));
    await waitFor(() => expect(approvedReads).toBe(2));
    fireEvent.click(screen.getByRole("tab", { name: "待审核" }));
    fireEvent.click(screen.getByRole("tab", { name: "已处理" }));
    await waitFor(() => expect(approvedReads).toBe(3));
    await act(async () => { first.resolve(page([])); });
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: /下架$/ })).toBeDisabled();
    await act(async () => { second.resolve(page([])); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("refreshes the current mode when an old drawer decision completes after space-to-mine mode switch", async () => {
    const decision = deferred<void>();
    vi.mocked(api.approveReview).mockReturnValue(decision.promise);
    vi.mocked(api.getReviewRequest).mockResolvedValue(request());
    vi.mocked(api.listReviewRequests).mockImplementation(async (mode) => page([request(mode === "space" ? "a" : "mine-row")]));
    const { rerender } = render(<ReviewQueue mode="space" />);
    fireEvent.click(await screen.findByRole("button", { name: "a", exact: true }));
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(await within(drawer).findByRole("button", { name: "通过并上架" }));
    rerender(<ReviewQueue mode="mine" />);
    await screen.findByText("mine-row", { exact: true });
    await act(async () => { decision.resolve(); });
    expect(vi.mocked(api.listReviewRequests).mock.calls.map(([mode]) => mode)).toEqual(["space", "mine", "mine"]);
    expect(screen.getByText("mine-row", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("a", { exact: true })).not.toBeInTheDocument();
  });
});

// Each newly attached observer reports its initial intersecting observation,
// just like the browser. Deferred API failures leave time for a committed busy
// render, exposing the observer recreation loop the inert shared stub misses.
function installDrivingObserver() {
  let deliveries = 0;
  class DrivingObserver {
    private connected = true;
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      setTimeout(() => {
        if (this.connected && deliveries++ < 30) {
          this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        }
      }, 0);
    }
    disconnect() { this.connected = false; }
    unobserve() {}
  }
  vi.stubGlobal("IntersectionObserver", DrivingObserver);
}

describe("ReviewQueue explicit pagination recovery", () => {
  beforeEach(installDrivingObserver);

  it.each(["pending", "approved"] as const)("keeps %s rows and failed cursor, pauses automatic loading, then retries explicitly", async (status) => {
    const failed = deferred<PagedResult<ReviewRequest>>();
    const retried = deferred<PagedResult<ReviewRequest>>();
    let attempts = 0;
    vi.mocked(api.listReviewRequests).mockImplementation(async (_mode, params) => {
      if (params?.status !== status) return page([]);
      if (params?.page === 1) return page([request("first", status)], "2");
      attempts++;
      return attempts === 1 ? failed.promise : retried.promise;
    });
    render(<ReviewQueue mode="space" />);
    if (status !== "pending") fireEvent.click(screen.getByRole("tab", { name: "已处理" }));
    await waitFor(() => expect(attempts).toBe(1));
    expect(screen.getByText("first", { exact: true })).toBeInTheDocument();
    await act(async () => { failed.reject(new Error("Next page unavailable")); });
    await pause();
    expect(attempts).toBe(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Next page unavailable");
    expect(screen.getByText("first", { exact: true })).toBeInTheDocument();
    fireEvent.click(retry());
    await waitFor(() => expect(attempts).toBe(2));
    await act(async () => { retried.resolve(page([request("second", status)])); });
    expect(screen.getByText("first", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("second", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(vi.mocked(api.listReviewRequests).mock.calls.filter(([, params]) => params?.status === status && params?.page === 2)).toHaveLength(2);
  });

  it("retries only the failed handled bucket while retaining other successful pages", async () => {
    const failed = deferred<PagedResult<ReviewRequest>>();
    let failedAttempts = 0;
    vi.mocked(api.listReviewRequests).mockImplementation(async (_mode, params) => {
      if (params?.status === "approved") return params.page === 1
        ? page([request("approved-first", "approved")], "2") : page([request("approved-next", "approved")]);
      if (params?.status === "rejected") {
        if (params.page === 1) return page([request("rejected-first", "rejected")], "2");
        failedAttempts++;
        return failedAttempts === 1 ? failed.promise : page([request("rejected-next", "rejected")]);
      }
      return page([]);
    });
    render(<ReviewQueue mode="space" />);
    fireEvent.click(screen.getByRole("tab", { name: "已处理" }));
    await waitFor(() => expect(failedAttempts).toBe(1));
    await screen.findByText("approved-next");
    await act(async () => { failed.reject(new Error("Rejected page unavailable")); });
    await pause();
    expect(failedAttempts).toBe(1);
    fireEvent.click(retry());
    await screen.findByText("rejected-next");
    expect(screen.getByText("approved-next")).toBeInTheDocument();
    expect(vi.mocked(api.listReviewRequests).mock.calls.filter(([, params]) => params?.status === "approved" && params.page === 2)).toHaveLength(1);
  });

  it.each(["pending", "approved"] as const)("exposes a first-page %s failure with a working explicit retry", async (status) => {
    let attempts = 0;
    vi.mocked(api.listReviewRequests).mockImplementation(async (_mode, params) => {
      if (params?.status !== status) return page([]);
      if (++attempts === 1) throw new Error("Initial page unavailable");
      return page([request("recovered", status)]);
    });
    render(<ReviewQueue mode="space" />);
    if (status !== "pending") fireEvent.click(screen.getByRole("tab", { name: "已处理" }));
    await screen.findByText("Initial page unavailable");
    fireEvent.click(retry());
    await screen.findByText("recovered");
    expect(attempts).toBe(2);
  });

  it.each(["success", "failure"] as const)("drops stale page-two %s after switching Space", async (outcome) => {
    const old = deferred<PagedResult<ReviewRequest>>();
    vi.mocked(api.listReviewRequests).mockResolvedValueOnce(page([request("old-first")], "2"))
      .mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([request("new-first")]));
    render(<ReviewQueue mode="space" />);
    await waitFor(() => expect(api.listReviewRequests).toHaveBeenCalledTimes(2));
    switchSpace();
    await screen.findByText("new-first");
    await act(async () => { if (outcome === "success") old.resolve(page([request("old-next")])); else old.reject(new Error("old page error")); });
    expect(screen.getByText("new-first")).toBeInTheDocument();
    expect(screen.queryByText("old-next")).not.toBeInTheDocument();
    expect(screen.queryByText("old page error")).not.toBeInTheDocument();
    await pause();
    expect(api.listReviewRequests).toHaveBeenCalledTimes(3);
  });

  it("aborts the active pagination read on unmount and never follows its cursor", async () => {
    const read = deferred<PagedResult<ReviewRequest>>();
    vi.mocked(api.listReviewRequests).mockResolvedValueOnce(page([request("first")], "2")).mockReturnValueOnce(read.promise);
    const { unmount } = render(<ReviewQueue mode="space" />);
    await waitFor(() => expect(api.listReviewRequests).toHaveBeenCalledTimes(2));
    const signal = vi.mocked(api.listReviewRequests).mock.calls[1][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { read.resolve(page([request("late")], "3")); });
    await pause();
    expect(api.listReviewRequests).toHaveBeenCalledTimes(2);
  });

  it("discards a read completed after a silent Space change and exposes recovery feedback", async () => {
    const read = deferred<PagedResult<ReviewRequest>>();
    vi.mocked(api.listReviewRequests).mockResolvedValueOnce(page([request("first")], "2")).mockReturnValueOnce(read.promise);
    render(<ReviewQueue mode="space" />);
    await waitFor(() => expect(api.listReviewRequests).toHaveBeenCalledTimes(2));
    WKApp.shared.currentSpaceId = "space-b";
    await act(async () => { read.resolve(page([request("late")], "3")); });
    await pause();
    expect(screen.getByText("first", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("late", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("组织已切换");
    expect(api.listReviewRequests).toHaveBeenCalledTimes(2);
  });
});
