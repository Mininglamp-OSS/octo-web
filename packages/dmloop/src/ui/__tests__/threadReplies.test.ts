import { describe, it, expect } from "vitest";
import { buildRepliesByParent, collectThreadReplies } from "../threadReplies";
import type { IssueComment } from "../../api/types";

function comment(
  id: string,
  createdAt: string,
  parentId: string | null,
): IssueComment {
  return {
    id,
    issue_id: "issue-1",
    parent_id: parentId,
    author_type: "member",
    author_id: "u1",
    content: id,
    created_at: createdAt,
  };
}

describe("collectThreadReplies", () => {
  it("returns direct replies of the root", () => {
    const comments = [
      comment("root", "2026-07-14T10:00:00Z", null),
      comment("r1", "2026-07-14T10:01:00Z", "root"),
      comment("r2", "2026-07-14T10:02:00Z", "root"),
    ];
    expect(collectThreadReplies("root", buildRepliesByParent(comments)).map((c) => c.id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  // Regression: an agent reply nests under the member comment that triggered it,
  // not under the thread root. Taking only direct children dropped every agent
  // answer from the timeline even though the API returned them.
  it("includes grandchildren (agent replies nested under a member question)", () => {
    const comments = [
      comment("root", "2026-07-14T10:33:00Z", null),
      comment("m1", "2026-07-14T10:42:17Z", "root"),
      comment("a1", "2026-07-14T10:42:29Z", "m1"), // agent reply to m1
      comment("m2", "2026-07-14T10:42:27Z", "root"),
      comment("a2", "2026-07-14T10:43:10Z", "m2"), // agent reply to m2
    ];
    expect(collectThreadReplies("root", buildRepliesByParent(comments)).map((c) => c.id)).toEqual([
      "m1",
      "m2",
      "a1",
      "a2",
    ]);
  });

  it("orders the whole subtree chronologically, not depth-first", () => {
    // A slow agent's late reply must not jump ahead of an earlier sibling.
    const comments = [
      comment("root", "2026-07-14T10:00:00Z", null),
      comment("m1", "2026-07-14T10:01:00Z", "root"),
      comment("a1", "2026-07-14T10:05:00Z", "m1"), // slow answer
      comment("m2", "2026-07-14T10:02:00Z", "root"),
    ];
    expect(collectThreadReplies("root", buildRepliesByParent(comments)).map((c) => c.id)).toEqual([
      "m1",
      "m2",
      "a1",
    ]);
  });

  it("does not infinite-loop on a parent_id cycle", () => {
    const comments = [
      comment("root", "2026-07-14T10:00:00Z", null),
      comment("x", "2026-07-14T10:01:00Z", "y"),
      comment("y", "2026-07-14T10:02:00Z", "x"),
    ];
    // Cycle is unreachable from root → simply excluded, no hang.
    expect(collectThreadReplies("root", buildRepliesByParent(comments))).toEqual([]);
  });
});

describe("buildRepliesByParent", () => {
  it("groups replies under their parent_id and skips roots", () => {
    const comments = [
      comment("root", "2026-07-14T10:00:00Z", null),
      comment("r1", "2026-07-14T10:01:00Z", "root"),
      comment("a1", "2026-07-14T10:02:00Z", "r1"),
      comment("r2", "2026-07-14T10:03:00Z", "root"),
    ];
    const byParent = buildRepliesByParent(comments);
    expect(byParent.get("root")!.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(byParent.get("r1")!.map((c) => c.id)).toEqual(["a1"]);
    // Roots (no parent_id) are never keyed.
    expect(byParent.has("a1")).toBe(false);
  });
});
