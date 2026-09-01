export type ExpertListErrorKind =
  | "auth"
  | "forbidden"
  | "notfound"
  | "network"
  | "server"
  | "unknown";

export class ExpertListError extends Error {
  constructor(readonly kind: ExpertListErrorKind) { super(kind); }
}

export function classifyExpertListError(err: unknown): ExpertListErrorKind {
  const value = err as { response?: { status?: number }; code?: string };
  const status = value?.response?.status;
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  // A 404 is a distinct, recoverable case: a relation target that no longer
  // exists (soft-deleted / dangling) can be safely dropped, whereas every other
  // failure must surface rather than silently shrink a list.
  if (status === 404) return "notfound";
  if (!value?.response && (value?.code === "ERR_NETWORK" || value?.code === "ECONNABORTED")) return "network";
  if (status && status >= 500) return "server";
  return "unknown";
}

export async function executeExpertListRequest<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (err) {
    if (err instanceof ExpertListError) throw err;
    throw new ExpertListError(classifyExpertListError(err));
  }
}

export function expertListErrorI18nKey(err: unknown): string {
  return `mcp.list.error.${err instanceof ExpertListError ? err.kind : "unknown"}`;
}
