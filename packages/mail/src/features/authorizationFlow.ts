import type { AgentAuthorizationRequest } from "../bridge/types";

export type MailAuthorizationPhase =
  | "approval"
  | "connecting"
  | "connected"
  | "failed";

const DEFAULT_CONNECTION_POLL_INTERVAL_MS = 3_000;
const MIN_CONNECTION_POLL_INTERVAL_MS = 1_000;
const MAX_CONNECTION_POLL_INTERVAL_MS = 60_000;

export function authorizationPollIntervalMs(
  request?: Pick<AgentAuthorizationRequest, "pollIntervalSeconds">
): number {
  const seconds = request?.pollIntervalSeconds;
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return DEFAULT_CONNECTION_POLL_INTERVAL_MS;
  }
  return Math.min(
    MAX_CONNECTION_POLL_INTERVAL_MS,
    Math.max(MIN_CONNECTION_POLL_INTERVAL_MS, Math.round(seconds * 1_000))
  );
}

export function authorizationPhase(
  status: AgentAuthorizationRequest["status"] | string
): MailAuthorizationPhase {
  switch (status) {
    case "pending":
      return "approval";
    case "approved":
      return "connecting";
    case "exchanged":
      return "connected";
    case "denied":
      return "failed";
    default:
      return "failed";
  }
}

export function isAuthorizationExpired(
  request: Pick<AgentAuthorizationRequest, "expiresAt">,
  now = Date.now()
): boolean {
  const expiresAt = Date.parse(request.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
