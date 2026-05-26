import axios from "axios";
import { WKApp } from "@octo/base";
import type {
  Flow,
  FlowDefinition,
  FlowExecution,
  ListExecutionsResponse,
  ListFlowsResponse,
} from "../types/flow";

const flowAxios = axios.create({ baseURL: "" });

flowAxios.interceptors.request.use((config) => {
  const token = WKApp.loginInfo.token;
  if (token) {
    (config.headers as Record<string, string>)["token"] = token;
  }
  const spaceId = WKApp.shared.currentSpaceId;
  if (spaceId) {
    (config.headers as Record<string, string>)["X-Space-Id"] = spaceId;
  }
  return config;
});

flowAxios.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err?.response?.status === 401) {
      WKApp.shared.logout();
    }
    return Promise.reject(err);
  },
);

function apiBase(): string {
  // octo-server mounts Flow routes under /v1/...; the web build proxies
  // /api → server, so the absolute path on this side is /api/v1/flows.
  // We reuse the configured apiURL prefix to stay consistent with other
  // modules (which call WKApp.apiClient — but Flow uses a raw axios
  // instance for response shape flexibility).
  return (WKApp.apiClient.config.apiURL || "/api/v1/").replace(/\/$/, "");
}

export interface CreateFlowParams {
  name: string;
  description?: string;
  definition: FlowDefinition;
}

export interface UpdateFlowParams {
  name?: string;
  description?: string;
  definition?: FlowDefinition;
}

function unwrap<T>(data: unknown): T {
  // Server may return either the bare object or { data: ... }.
  if (data && typeof data === "object" && "data" in (data as Record<string, unknown>)) {
    return (data as { data: T }).data;
  }
  return data as T;
}

export async function listFlows(): Promise<Flow[]> {
  const resp = await flowAxios.get(`${apiBase()}/flows`);
  const body = unwrap<ListFlowsResponse | Flow[]>(resp.data);
  return Array.isArray(body) ? body : body.items ?? [];
}

export async function getFlow(id: string): Promise<Flow> {
  const resp = await flowAxios.get(`${apiBase()}/flows/${id}`);
  return unwrap<Flow>(resp.data);
}

export async function createFlow(params: CreateFlowParams): Promise<Flow> {
  const resp = await flowAxios.post(`${apiBase()}/flows`, params);
  return unwrap<Flow>(resp.data);
}

export async function updateFlow(id: string, params: UpdateFlowParams): Promise<Flow> {
  const resp = await flowAxios.put(`${apiBase()}/flows/${id}`, params);
  return unwrap<Flow>(resp.data);
}

export async function deleteFlow(id: string): Promise<void> {
  await flowAxios.delete(`${apiBase()}/flows/${id}`);
}

export async function activateFlow(id: string): Promise<Flow> {
  const resp = await flowAxios.post(`${apiBase()}/flows/${id}/activate`);
  return unwrap<Flow>(resp.data);
}

export async function deactivateFlow(id: string): Promise<Flow> {
  const resp = await flowAxios.post(`${apiBase()}/flows/${id}/deactivate`);
  return unwrap<Flow>(resp.data);
}

export async function executeFlow(id: string, input?: unknown): Promise<FlowExecution> {
  const resp = await flowAxios.post(`${apiBase()}/flows/${id}/execute`, { input });
  return unwrap<FlowExecution>(resp.data);
}

export async function listExecutions(flowId: string): Promise<FlowExecution[]> {
  const resp = await flowAxios.get(`${apiBase()}/flows/${flowId}/executions`);
  const body = unwrap<ListExecutionsResponse | FlowExecution[]>(resp.data);
  return Array.isArray(body) ? body : body.items ?? [];
}

export async function getExecution(executionId: string): Promise<FlowExecution> {
  const resp = await flowAxios.get(`${apiBase()}/executions/${executionId}`);
  return unwrap<FlowExecution>(resp.data);
}

export async function cancelExecution(executionId: string): Promise<void> {
  await flowAxios.post(`${apiBase()}/executions/${executionId}/cancel`);
}

export interface WebhookInfo {
  url: string;
  /** Optional configured signature header; the raw secret is never returned. */
  signatureHeader?: string;
}

/**
 * Fetch the canonical webhook URL minted by the server. We prefer this over
 * deriving the URL from the apiBase locally because the server may publish a
 * different host (e.g. webhook ingress vs. API ingress) and may include a
 * token segment in the path.
 */
export async function getWebhookUrl(flowId: string): Promise<WebhookInfo> {
  const resp = await flowAxios.get(`${apiBase()}/flows/${flowId}/webhook`);
  const body = unwrap<Partial<WebhookInfo> | string>(resp.data);
  if (typeof body === "string") {
    return { url: body };
  }
  return {
    url: body.url ?? "",
    signatureHeader: body.signatureHeader,
  };
}
