import { describe, expect, it } from "vitest";

import { groupIssuesByAssignee } from "../issueGrouping";
import type { Issue } from "../types";

const issue = (id: string, type: Issue["assignee_type"], assignee: string | null, name?: string): Issue =>
  ({ id, assignee_type: type, assignee_id: assignee, assignee_name: name } as Issue);

// Locks the client-side grouping used to render flat /issues/search results in
// the grouped view (keyword search, scheme B).
describe("groupIssuesByAssignee", () => {
  it("groups by (assignee_type, assignee_id), preserves first-seen order, counts per group", () => {
    const groups = groupIssuesByAssignee([
      issue("1", "member", "u1", "Alice"),
      issue("2", "agent", "a1", "Bot"),
      issue("3", "member", "u1", "Alice"),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["member::u1", "agent::a1"]);
    expect(groups[0].total).toBe(2);
    expect(groups[0].assignee_name).toBe("Alice");
    expect(groups[1].total).toBe(1);
    expect(groups[0].issues.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("folds unassigned issues into a single null group", () => {
    const groups = groupIssuesByAssignee([
      issue("1", null, null),
      issue("2", null, null),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].assignee_type).toBeNull();
    expect(groups[0].assignee_id).toBeNull();
    expect(groups[0].total).toBe(2);
  });

  it("returns [] for no issues", () => {
    expect(groupIssuesByAssignee([])).toEqual([]);
  });
});
