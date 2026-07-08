// @octo/runtime — HTTP 客户端（真实网络请求，路径对齐 multica REST 契约；本版命中 MSW mock）
import axios from "axios";

export const LOOP_API_BASE =
  (import.meta as { env?: Record<string, string> }).env?.VITE_LOOP_API_BASE ||
  "/fleet/api/v1";

const client = axios.create({ baseURL: LOOP_API_BASE });

function clean(params?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") out[k] = String(v);
  }
  return out;
}

export async function httpGet<T>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const resp = await client.get<T>(path, { params: clean(params) });
  return resp.data;
}
