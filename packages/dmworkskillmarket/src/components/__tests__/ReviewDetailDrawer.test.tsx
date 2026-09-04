import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewDetailDrawer from "../ReviewDetailDrawer";
import * as api from "../../api/skillApi";
import type { ReviewRequest } from "../../types/skill";

vi.mock("../../api/skillApi");

function detail(): ReviewRequest {
  return {
    id: "review-1",
    pluginId: "team-1",
    pluginName: "Planning Team",
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
});
