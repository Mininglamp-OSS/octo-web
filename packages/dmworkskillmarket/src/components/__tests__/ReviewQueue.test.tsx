import React from "react";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import ReviewQueue from "../ReviewQueue";
import type { PagedResult, ReviewRequest } from "../../types/skill";
import * as api from "../../api/skillApi";

vi.mock("../../api/skillApi");

// Tolerant of a missing translation, matching the existing page test's idiom.
const pendingTabName = /待审核|skillMarket\.review\.queuePending/;
const handledTabName = /已处理|skillMarket\.review\.queueHandled/;

// The queue now renders the SAME `MineTable` as 我的发布 instead of a bespoke
// flex card list, and every row action carries a name-scoped aria-label
// (`skillMarket.plugin.aria*`). The accessible name is therefore the label, not
// the button text, so a bare 通过/拒绝 no longer identifies anything — each query
// has to name the plugin the action belongs to. That is strictly more specific
// than the old positional/text lookup: it cannot match another row's button.
const DEFAULT_PLUGIN = "CI 失败分析";
const approveName = (plugin = DEFAULT_PLUGIN) =>
  new RegExp(`^(通过「${plugin}」的上架申请|skillMarket\\.plugin\\.ariaApprove)$`);
const rejectName = (plugin = DEFAULT_PLUGIN) =>
  new RegExp(`^(拒绝「${plugin}」的上架申请|skillMarket\\.plugin\\.ariaReject)$`);
const confirmRejectName = /确认拒绝|skillMarket\.review\.rejectConfirm/;
// 撤回申请 collapsed into the shared 取消审核 action; same call, same intent.
const cancelReviewName = (plugin = DEFAULT_PLUGIN) =>
  new RegExp(`^(取消「${plugin}」的审核申请|skillMarket\\.plugin\\.ariaCancelReview)$`);

function request(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: "rev-1",
    pluginId: "plugin-1",
    pluginName: "CI 失败分析",
    pluginType: "skill",
    spaceId: "dev-space",
    targetScope: "space",
    status: "pending",
    kind: "first",
    version: "0.1.0",
    applicantId: "test-uid",
    applicantName: "Jian",
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

function page(items: ReviewRequest[], nextCursor: string | null = null, total?: number): PagedResult<ReviewRequest> {
  return { items, nextCursor, total: total ?? items.length };
}

beforeEach(() => {
  vi.mocked(api.listReviewRequests).mockResolvedValue(page([request()]));
  vi.mocked(api.approveReview).mockResolvedValue(undefined);
  vi.mocked(api.rejectReview).mockResolvedValue(undefined);
  vi.mocked(api.cancelReview).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReviewQueue", () => {
  it("loads the pending sub-tab first and renders the row summary", async () => {
    render(<ReviewQueue mode="space" />);

    expect(await screen.findByText("CI 失败分析")).toBeInTheDocument();
    expect(api.listReviewRequests).toHaveBeenCalledWith(
      "space",
      expect.objectContaining({ status: "pending" })
    );
    expect(screen.getByRole("tab", { name: pendingTabName })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("switches to 已处理 and hides pending rows via explicit per-status fetches (defect 4)", async () => {
    // On the handled tab we expect three parallel fetches for approved/
    // rejected/canceled — never one unfiltered list that includes pending
    // rows which the UI then filters out client-side (which caused the
    // empty-page cascade in the source implementation).
    vi.mocked(api.listReviewRequests).mockImplementation(async (_mode, params) => {
      if (params?.status === "pending") return page([request()]);
      if (params?.status === "approved") return page([request({ id: "rev-2", status: "approved", pluginName: "已通过插件" })]);
      if (params?.status === "rejected") return page([]);
      if (params?.status === "canceled") return page([]);
      return page([]);
    });

    render(<ReviewQueue mode="space" />);
    await screen.findByText("CI 失败分析");

    fireEvent.click(screen.getByRole("tab", { name: handledTabName }));

    expect(await screen.findByText("已通过插件")).toBeInTheDocument();
    // Pending rows must not appear in 已处理.
    expect(screen.queryByText("CI 失败分析")).not.toBeInTheDocument();
    // And the three terminal statuses must all be explicitly requested.
    expect(api.listReviewRequests).toHaveBeenCalledWith(
      "space",
      expect.objectContaining({ status: "approved", pageSize: 20 }),
    );
    expect(api.listReviewRequests).toHaveBeenCalledWith(
      "space",
      expect.objectContaining({ status: "rejected", pageSize: 20 }),
    );
    expect(api.listReviewRequests).toHaveBeenCalledWith(
      "space",
      expect.objectContaining({ status: "canceled", pageSize: 20 }),
    );
  });

  it("requires a reason before rejecting", async () => {
    render(<ReviewQueue mode="space" />);
    await screen.findByText("CI 失败分析");

    fireEvent.click(screen.getByRole("button", { name: rejectName() }));

    const confirm = await screen.findByRole("button", { name: confirmRejectName });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.rejectReview).not.toHaveBeenCalled());

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  描述不清晰  " },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.rejectReview).toHaveBeenCalledWith("rev-1", "描述不清晰")
    );
  });

  it("shows a queue-level error and refreshes on a reject wire failure (defect 2)", async () => {
    vi.mocked(api.rejectReview).mockRejectedValueOnce(new Error("CONFLICT: already decided"));
    render(<ReviewQueue mode="space" />);
    await screen.findByText("CI 失败分析");

    fireEvent.click(screen.getByRole("button", { name: rejectName() }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: confirmRejectName }));

    // The wire error surfaces as the queue-level error banner AND the modal's
    // own inline error; a refresh has been kicked off so the row reconciles.
    expect(await screen.findByText("CONFLICT: already decided")).toBeInTheDocument();
    await waitFor(() => {
      // listReviewRequests is called again to refresh after the failure.
      expect(api.listReviewRequests).toHaveBeenCalledWith(
        "space",
        expect.objectContaining({ status: "pending" }),
      );
    });
  });

  it("keeps the row disabled until the post-approve refresh settles (defect 3)", async () => {
    let resolveApprove: () => void = () => {};
    let resolveRefresh: () => void = () => {};
    vi.mocked(api.approveReview).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveApprove = resolve; }),
    );
    vi.mocked(api.listReviewRequests).mockImplementationOnce(
      () => Promise.resolve(page([request()])),
    );
    vi.mocked(api.listReviewRequests).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveRefresh = () => resolve(page([]));
      }),
    );
    render(<ReviewQueue mode="space" />);
    await screen.findByText("CI 失败分析");

    const approveBtn = screen.getByRole("button", { name: approveName() });
    fireEvent.click(approveBtn);

    // Button must be disabled immediately (it shows "处理中"); while the
    // approve is in flight and then while the refresh is in flight, the
    // button stays disabled, so a double-click cannot fire a second approve
    // against an already-decided request.
    await waitFor(() => expect(approveBtn).toBeDisabled());
    expect(screen.getByRole("button", { name: rejectName() })).toBeDisabled();

    // Resolve the approve — the button must still be disabled because the
    // refresh is still in flight.
    await act(async () => { resolveApprove(); });
    expect(approveBtn).toBeDisabled();

    // Once the refresh settles the row is gone (empty list), so a second
    // click is impossible.
    await act(async () => { resolveRefresh(); });
    await waitFor(() => {
      expect(screen.queryByText("CI 失败分析")).not.toBeInTheDocument();
    });
  });

  it("offers 取消审核 (not approve/reject) in mine mode for the applicant", async () => {
    render(<ReviewQueue mode="mine" />);
    await screen.findByText(DEFAULT_PLUGIN);

    expect(screen.queryByRole("button", { name: approveName() })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: rejectName() })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: cancelReviewName() }));

    await waitFor(() => expect(api.cancelReview).toHaveBeenCalledWith("rev-1"));
  });

  it("offers no 取消审核 for another user's request in mine mode", async () => {
    vi.mocked(api.listReviewRequests).mockResolvedValue(
      page([request({ applicantId: "someone-else" })])
    );

    render(<ReviewQueue mode="mine" />);
    await screen.findByText(DEFAULT_PLUGIN);

    expect(
      screen.queryByRole("button", { name: cancelReviewName() })
    ).not.toBeInTheDocument();
  });

  it("shows no reviewer actions on an already-decided row", async () => {
    vi.mocked(api.listReviewRequests).mockResolvedValue(
      page([request({ status: "rejected", reason: "缺少说明" })])
    );

    render(<ReviewQueue mode="space" />);
    // For rejected rows we don't expect the approved/plugin name via the
    // pending path. Drive the handled tab to surface them.
    vi.mocked(api.listReviewRequests).mockImplementation(async (_mode, params) => {
      if (params?.status === "pending") return page([]);
      if (params?.status === "rejected") return page([request({ id: "rev-r", status: "rejected", reason: "缺少说明", pluginName: "Rejected Plugin" })]);
      return page([]);
    });
    fireEvent.click(screen.getByRole("tab", { name: pendingTabName }));
    fireEvent.click(screen.getByRole("tab", { name: handledTabName }));
    expect(await screen.findByText("Rejected Plugin")).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: approveName("Rejected Plugin") })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: rejectName("Rejected Plugin") })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/缺少说明/)).toBeInTheDocument();
  });

  it("renders the version bump for an upgrade request", async () => {
    vi.mocked(api.listReviewRequests).mockResolvedValue(
      page([request({ kind: "upgrade", currentVersion: "1.0.0", version: "1.1.0" })])
    );

    render(<ReviewQueue mode="space" />);

    expect(await screen.findByText(/v1\.0\.0.*v1\.1\.0/)).toBeInTheDocument();
  });

  it("clears the old Space rows while the replacement fetch is pending", async () => {
    let resolveNew: (value: PagedResult<ReviewRequest>) => void = () => {};
    vi.mocked(api.listReviewRequests)
      .mockResolvedValueOnce(page([request({ pluginName: "Space A request", spaceId: "space-a" })]))
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveNew = resolve; }),
      );

    render(<ReviewQueue mode="space" />);
    expect(await screen.findByText("Space A request")).toBeInTheDocument();
    act(() => {
      WKApp.mittBus.emit("space-changed", { space_id: "space-b", role: 2 });
    });

    expect(screen.queryByText("Space A request")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: approveName("Space A request") })).not.toBeInTheDocument();
    await act(async () => {
      resolveNew(page([request({ id: "rev-b", pluginName: "Space B request", spaceId: "space-b" })]));
    });
    expect(await screen.findByText("Space B request")).toBeInTheDocument();
  });

  it("ignores an old-Space action continuation after switching Space", async () => {
    let rejectApprove: (reason: Error) => void = () => {};
    vi.mocked(api.listReviewRequests)
      .mockResolvedValueOnce(page([request({ pluginName: "Space A request" })]))
      .mockResolvedValueOnce(page([request({ id: "rev-b", pluginName: "Space B request", spaceId: "space-b" })]));
    vi.mocked(api.approveReview).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectApprove = reject; }),
    );

    render(<ReviewQueue mode="space" />);
    fireEvent.click(await screen.findByRole("button", { name: approveName("Space A request") }));
    act(() => {
      WKApp.mittBus.emit("space-changed", { space_id: "space-b", role: 2 });
    });
    expect(await screen.findByText("Space B request")).toBeInTheDocument();

    await act(async () => {
      rejectApprove(new Error("old Space failure"));
    });
    expect(screen.queryByText("old Space failure")).not.toBeInTheDocument();
    expect(screen.getByText("Space B request")).toBeInTheDocument();
    expect(api.listReviewRequests).toHaveBeenCalledTimes(2);
  });

  it("surfaces a load failure instead of an empty state", async () => {
    vi.mocked(api.listReviewRequests).mockRejectedValue(new Error("boom"));

    render(<ReviewQueue mode="space" />);

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
