import { describe, expect, it } from "vitest";

import {
  buildGroupCreateOrganizationTree,
  collectGroupCreateOrganizationMembers,
} from "./organizationCompatibility";

describe("group create organization compatibility", () => {
  it("keeps nested department counts and employee ordering", () => {
    const tree = buildGroupCreateOrganizationTree([
      {
        dept_id: "root",
        name: "Engineering",
        org_id: "org-1",
        short_no: "engineering",
        employees: [{ employee_id: "1", employee_name: "Alice", uid: "alice" }],
        children: [
          {
            dept_id: "child",
            name: "Frontend",
            org_id: "org-1",
            short_no: "frontend",
            employees: [{ employee_id: "2", employee_name: "Bob", uid: "bob" }],
          },
        ],
      },
    ]);

    expect(tree[0].label).toBe("Engineering(2)");
    expect(tree[0].children?.map((node) => node.key)).toEqual([
      "frontend",
      "root_1",
    ]);
    expect(collectGroupCreateOrganizationMembers(tree)).toEqual([
      { uid: "bob", name: "Bob", avatar: undefined },
      { uid: "alice", name: "Alice", avatar: undefined },
    ]);
  });
});
