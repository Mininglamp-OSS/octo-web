export type PersonalTabKey = "runtime" | "skill";

export interface PersonalWorkspaceStateRenderArgs {
  status: "loading" | "error";
  title: string;
  desc?: string;
}
