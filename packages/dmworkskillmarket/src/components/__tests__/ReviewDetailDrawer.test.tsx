import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("drops an old review approve continuation after another review opens", async () => {
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
    resolveApprove();

    await waitFor(() => expect(api.approveReview).toHaveBeenCalledWith("review-a"));
    expect(onDecided).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Skill B")).toBeInTheDocument();
  });
});
