// @dmwork/flow — Type definitions for the Octo Flow visual editor.
// Mirrors the contracts exposed by octo-server feat/octo-flow.

export type FlowStatus = "draft" | "active" | "disabled";

export type NodeType =
  // triggers
  | "trigger.webhook"
  | "trigger.cron"
  | "trigger.manual"
  // logic
  | "logic.condition"
  | "logic.parallel"
  // actions
  | "action.script"
  | "action.http"
  | "action.bot"
  // human (Phase 2 — disabled in palette)
  | "human.approval";

export type NodeCategory = "trigger" | "logic" | "action" | "human";

export interface FlowNodeConfig {
  // Trigger.webhook
  webhookUrl?: string;
  secret?: string;
  signatureHeader?: string;
  signatureAlgo?: "hmac-sha256" | "hmac-sha1" | "none";
  // Trigger.cron
  cronExpression?: string;
  cronTimezone?: string;
  // Action.script
  scriptLanguage?: "javascript";
  scriptCode?: string;
  // Action.http
  httpMethod?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  httpUrl?: string;
  httpHeaders?: Array<{ key: string; value: string }>;
  httpBody?: string;
  // Action.bot — Phase 2 placeholder
  botId?: string;
  botAction?: string;
  // Logic.condition
  conditionExpression?: string;
  conditionBranches?: Array<{ value: string; label: string }>;
  // Generic — node display name
  label?: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  config: FlowNodeConfig;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Branch label for condition edges (matches a value in conditionBranches). */
  branch?: string;
  label?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface Flow {
  id: string;
  space_id?: string;
  name: string;
  description?: string;
  status: FlowStatus;
  definition: FlowDefinition;
  created_at: string;
  updated_at?: string;
  last_execution_status?: ExecutionStatus | null;
  last_execution_at?: string | null;
}

export type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export interface NodeExecutionState {
  node_id: string;
  status: ExecutionStatus;
  started_at?: string;
  finished_at?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface FlowExecution {
  id: string;
  flow_id: string;
  status: ExecutionStatus;
  trigger_type?: string;
  started_at: string;
  finished_at?: string;
  node_states?: NodeExecutionState[];
  error?: string;
}

export interface ListFlowsResponse {
  items: Flow[];
  total?: number;
}

export interface ListExecutionsResponse {
  items: FlowExecution[];
  total?: number;
}
