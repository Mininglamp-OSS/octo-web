import { describe, expect, it } from "vitest";
import { isWorkspaceGroupContext, type WorkspaceGroupContext } from "./contract";

const target = { channelId: "group-a", channelType: 2 as const };
const context: WorkspaceGroupContext = {
  ...target,
  projectId: "project-a",
  projectName: "Workspace A",
  groupName: "Group A",
  linkedByName: "Evan",
  source: "linked_existing",
  canOpen: true,
  canManage: true,
  isAllMemberGroup: false,
};

describe("workspace group context validation", () => {
  it("accepts long project and group names without display controls", () => {
    expect(isWorkspaceGroupContext({
      ...context,
      projectName: "p".repeat(257),
      groupName: "g".repeat(257),
    }, target)).toBe(true);
  });

  it.each([
    { projectName: "Workspace\u202E spoof" },
    { groupName: "Group\u2066 spoof" },
  ])("rejects unsafe rendered identity text: %j", unsafe => {
    expect(isWorkspaceGroupContext({ ...context, ...unsafe }, target)).toBe(false);
  });
});
