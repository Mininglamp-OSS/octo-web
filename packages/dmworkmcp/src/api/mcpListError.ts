export type McpListErrorKind = "auth" | "forbidden" | "network" | "server" | "unknown";

export class McpListError extends Error {
  constructor(readonly kind: McpListErrorKind) { super(kind); }
}

export function classifyMcpListError(err: unknown): McpListErrorKind {
  const value = err as { response?: { status?: number }; code?: string };
  const status = value?.response?.status;
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (!value?.response && (value?.code === "ERR_NETWORK" || value?.code === "ECONNABORTED")) return "network";
  if (status && status >= 500) return "server";
  return "unknown";
}

export async function executeMcpListRequest<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (err) {
    if (err instanceof McpListError) throw err;
    throw new McpListError(classifyMcpListError(err));
  }
}

export function mcpListErrorI18nKey(err: unknown): string {
  return `mcp.list.error.${err instanceof McpListError ? err.kind : "unknown"}`;
}
