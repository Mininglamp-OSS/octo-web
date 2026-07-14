// @octo/loop — Loop panel (二级菜单：Issue/Skill/Project/Agent/Squad/Runtime) for octo-web

export { default as LoopModule } from "./module";
export { default as LoopPage } from "./pages/LoopPage";
export { default as LoopCliAuthorizePage } from "./pages/LoopCliAuthorizePage";
export { default as RuntimePage } from "./pages/RuntimePage";
export { default as SkillPage } from "./pages/SkillPage";
export {
  isLoopCliAuthorizePath,
  LOOP_CLI_AUTHORIZE_PATH,
} from "./cliAuthorizeSession";

export * from "./api/types";
export * as issueApi from "./api/issueApi";
export * as skillApi from "./api/skillApi";
export * as projectApi from "./api/projectApi";
export * as agentApi from "./api/agentApi";
export * as squadApi from "./api/squadApi";
export * as autopilotApi from "./api/autopilotApi";
export * as runtimeApi from "./api/runtimeApi";
export * as workspaceApi from "./api/workspaceApi";
export * as authApi from "./api/authApi";
export {
  LOOP_API_BASE,
  currentWorkspaceSlug,
  currentWorkspaceId,
  setWorkspaceContext,
  LoopApiError,
} from "./api/http";
export { resolveWorkspaceSelection, runtimeListPath } from "./api/workspaceSelection";
export type { WorkspaceSelection } from "./api/workspaceSelection";
