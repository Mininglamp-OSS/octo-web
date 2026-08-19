export function isTransientMailPollError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const candidate = error as {
    status?: unknown;
    normalized?: { httpStatus?: unknown };
  };
  const rawStatus = candidate.status ?? candidate.normalized?.httpStatus;
  if (rawStatus === undefined || rawStatus === null) return true;
  const status = Number(rawStatus);
  if (!Number.isFinite(status) || status <= 0) return true;
  return status === 408 || status === 429 || status >= 500;
}
