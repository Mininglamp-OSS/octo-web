import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import ReviewDetailDrawer from "../ReviewDetailDrawer";
import * as api from "../../api/skillApi";
import type { ReviewRequest } from "../../types/skill";

vi.mock("../../api/skillApi");

function detail(id = "review-1", pluginName = "Planning Team"): ReviewRequest {
  return {
    id,
    pluginId: `team-${id}`,
    pluginName,
    pluginType: "expert_team",
    spaceId: "space-1",
    targetScope: "space",
    status: "pending",
    kind: "first",
    version: "1.0.0",
    applicantId: "applicant-1",
    applicantName: "Alice",
    submittedAt: "2026-09-04T00:00:00Z",
    frozenRelations: [{
      relationId: "relation-1",
      targetPluginId: "expert-child-1",
      targetPluginType: "expert",
      relationType: "team_member",
      sortOrder: 1,
      data: { is_leader: true, role: "planner", member_key: "lead" },
    }],
  };
}

describe("ReviewDetailDrawer frozen relations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    WKApp.shared.currentSpaceId = "space-1";
    vi.mocked(api.getReviewRequest).mockResolvedValue(detail());
  });

  it("shows the frozen relation graph and approval-critical wiring", async () => {
    render(
      <ReviewDetailDrawer
        reviewId="review-1"
        canReview
        onClose={vi.fn()}
        onDecided={vi.fn()}
      />
    );

    expect(await screen.findByText("expert-child-1")).toBeInTheDocument();
    expect(screen.getByText("team_member")).toBeInTheDocument();
    expect(screen.getByText(/"is_leader": true/)).toBeInTheDocument();
    expect(screen.getByText(/"role": "planner"/)).toBeInTheDocument();
    expect(screen.getByText(/"member_key": "lead"/)).toBeInTheDocument();
  });

  it("does not reopen a reject dialog when the drawer switches reviews", async () => {
    vi.mocked(api.getReviewRequest)
      .mockResolvedValueOnce(detail("review-a", "Skill A"))
      .mockResolvedValueOnce(detail("review-b", "Skill B"));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    const { rerender } = render(<ReviewDetailDrawer {...props} reviewId="review-a" />);

    await screen.findByText("Skill A", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: /拒绝|review\.reject/ }));
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    rerender(<ReviewDetailDrawer {...props} reviewId={null} />);
    rerender(<ReviewDetailDrawer {...props} reviewId="review-b" />);
    await screen.findByText("Skill B");

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("refreshes the queue after a same-Space decision without closing another review", async () => {
    let resolveApprove!: () => void;
    vi.mocked(api.approveReview).mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveApprove = resolve;
    }));
    vi.mocked(api.getReviewRequest)
      .mockResolvedValueOnce(detail("review-a", "Skill A"))
      .mockResolvedValueOnce(detail("review-b", "Skill B"));
    const onClose = vi.fn();
    const onDecided = vi.fn();
    const { rerender } = render(
      <ReviewDetailDrawer reviewId="review-a" canReview onClose={onClose} onDecided={onDecided} />,
    );

    await screen.findByText("Skill A", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: /通过并上架|approveAndPublish/ }));
    rerender(<ReviewDetailDrawer reviewId="review-b" canReview onClose={onClose} onDecided={onDecided} />);
    await screen.findByText("Skill B");
    await act(async () => resolveApprove());

    await waitFor(() => expect(api.approveReview).toHaveBeenCalledWith("review-a"));
    expect(onDecided).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Skill B")).toBeInTheDocument();
  });

  it("keeps the rejection reason and error visible after a 409 and allows retry", async () => {
    vi.mocked(api.rejectReview)
      .mockRejectedValueOnce(new Error("Review already decided (409)"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onDecided = vi.fn();
    render(<ReviewDetailDrawer reviewId="review-1" canReview onClose={onClose} onDecided={onDecided} />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "拒绝", exact: true }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Needs clarification" } });
    fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));

    const rejectDialog = screen.getByRole("dialog", { name: "拒绝审核" });
    expect(await within(rejectDialog).findByText("Review already decided (409)")).toBeInTheDocument();
    expect(within(rejectDialog).getByRole("textbox")).toHaveValue("Needs clarification");
    expect(api.getReviewRequest).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onDecided).not.toHaveBeenCalled();

    fireEvent.click(within(rejectDialog).getByRole("button", { name: "确认拒绝" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(api.rejectReview).toHaveBeenLastCalledWith("review-1", "Needs clarification");
  });

  it.each(["approve", "reject"] as const)("blocks every drawer close while %s is pending", async (action) => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    vi.mocked(action === "approve" ? api.approveReview : api.rejectReview).mockReturnValueOnce(pending);
    const onClose = vi.fn();
    const onDecided = vi.fn();
    render(<ReviewDetailDrawer reviewId="review-1" canReview onClose={onClose} onDecided={onDecided} />);
    await screen.findByText("Planning Team", { exact: true });
    const drawer = screen.getByRole("dialog");
    if (action === "reject") {
      fireEvent.click(screen.getByRole("button", { name: "拒绝", exact: true }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Reason" } });
      fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    }
    expect(within(drawer).getByRole("button", { name: "取消" })).toBeDisabled();
    for (const close of screen.getAllByRole("button", { name: "关闭" })) fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(onDecided).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure"] as const)("ignores an old action %s after closing and reopening the same review", async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    let resolveNew!: () => void;
    vi.mocked(api.approveReview)
      .mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail; }))
      .mockReturnValueOnce(new Promise<void>((done) => { resolveNew = done; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    const { rerender } = render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    rerender(<ReviewDetailDrawer {...props} reviewId={null} />);
    rerender(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    await act(async () => outcome === "success" ? resolve() : reject(new Error("Old failure")));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onDecided).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
    expect(screen.queryByText("Old failure")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /通过并上架/ })).toBeDisabled();
    await act(async () => resolveNew());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each(["space", "unmount"] as const)("abandons an in-flight decision on %s", async (change) => {
    let resolve!: () => void;
    vi.mocked(api.approveReview).mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    const { unmount } = render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    if (change === "space") {
      act(() => {
        WKApp.shared.currentSpaceId = "space-2";
        WKApp.mittBus.emit("space-changed");
      });
    } else unmount();
    props.onClose.mockClear();
    await act(async () => resolve());
    expect(props.onDecided).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
