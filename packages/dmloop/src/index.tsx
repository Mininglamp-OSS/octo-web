// @octo/loop — Loop panel (二级菜单：Issue/Skill/Project/Agent/Squad) for octo-web

export { default as LoopModule } from "./module";
export { default as LoopPage } from "./pages/LoopPage";

export * from "./api/types";
export * as issueApi from "./api/issueApi";
export * as skillApi from "./api/skillApi";
export * as projectApi from "./api/projectApi";
export * as agentApi from "./api/agentApi";
export * as squadApi from "./api/squadApi";
export * as workspaceApi from "./api/workspaceApi";
export { currentWorkspaceId, setWorkspaceId, LOOP_API_BASE } from "./api/http";

// Mock（MSW）启动器 + handlers，供宿主集中初始化真实 HTTP mock。
export { startLoopMock, loopHandlers } from "./api/mock/server";
