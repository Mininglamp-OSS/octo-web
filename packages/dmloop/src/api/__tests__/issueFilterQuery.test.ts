import { describe, expect, it } from "vitest";

import { arrayFilterQuery } from "../issueFilterQuery";

// Locks the query-string contract the board/list/grouped requests emit for the
// unified multi-select filters (backend: octo-multica flat ListIssues + grouped).
describe("arrayFilterQuery", () => {
  it("joins arrays with commas and maps booleans to true-string", () => {
    expect(
      arrayFilterQuery({
        statuses: ["todo", "in_progress"],
        priorities: ["high"],
        assignee_types: ["member", "agent"],
        assignee_ids: ["a1", "a2"],
        include_no_assignee: true,
        creator_ids: ["c1"],
        project_ids: ["p1", "p2"],
        include_no_project: true,
        label_ids: ["l1"],
      }),
    ).toEqual({
      statuses: "todo,in_progress",
      priorities: "high",
      assignee_types: "member,agent",
      assignee_ids: "a1,a2",
      include_no_assignee: "true",
      creator_ids: "c1",
      project_ids: "p1,p2",
      include_no_project: "true",
      label_ids: "l1",
    });
  });

  it("omits unset dimensions as undefined so they are never sent", () => {
    const q = arrayFilterQuery({});
    for (const v of Object.values(q)) expect(v).toBeUndefined();
    // false booleans drop to undefined, never a false-string.
    expect(arrayFilterQuery({ include_no_assignee: false }).include_no_assignee).toBeUndefined();
  });
});
