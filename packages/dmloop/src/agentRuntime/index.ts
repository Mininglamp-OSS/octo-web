// @octo/loop — Agent Runtime UI 对外出口
//
// 汇总「Agent Runtime UI」新增能力：运行期 API 客户端、事件流 hook 与归约器、
// verbose / 富 diff / checkpoint 组件、顶层面板。
//
// 注意：这是相对既有 loop 面板的增量特性，尚未挂进主路由（顶层 <AgentRuntimePanel>
// 需要一个已选定的会话上下文）。宿主接入时先调用 initAgentRuntimeAuth() 注入鉴权。

export { default as AgentRuntimePanel } from "./AgentRuntimePanel";
export type { AgentRuntimePanelProps } from "./AgentRuntimePanel";
export { default as VerboseRenderer } from "./VerboseRenderer";
export type { VerboseLevel } from "./VerboseRenderer";
export { default as DiffView } from "./DiffView";
export { default as CheckpointTimeline } from "./CheckpointTimeline";
export { default as SessionList } from "./SessionList";

export { useAgentStream, entriesToEvents } from "./useAgentStream";
export type { UseAgentStreamResult } from "./useAgentStream";
export * from "./streamReducer";
export { wordDiff, tokenize } from "./wordDiff";
export type { WordDiffSegment, WordDiffKind } from "./wordDiff";

export * as agentRuntimeApi from "../api/agentRuntime/agentRuntimeApi";
export * from "../api/agentRuntime/contracts";
export { AgentRuntimeError, setAuthTokenProvider, setUnauthorizedHandler } from "../api/agentRuntime/httpClient";
export { initAgentRuntimeAuth } from "./bootstrap";
