export const agentMailProxyContext = "^/agent-mail-api(?:[/?]|$)";

const agentMailBootstrapPaths = new Set([
  "/agent-mail-api/webapi/v0/agent-auth/device",
  "/agent-mail-api/webapi/v0/agent-auth/token",
  // Vite rewrites request.url before its proxyReq hook runs.
  "/webapi/v0/agent-auth/device",
  "/webapi/v0/agent-auth/token",
]);

export const browserMailProxyStrippedHeaders = [
  "authorization",
  "cookie",
] as const;

export const agentMailProxyStrippedHeaders = [
  "token",
  "x-space-id",
  "x-octo-mailbox-id",
  "cookie",
] as const;

export const agentMailBootstrapStrippedHeaders = [
  ...agentMailProxyStrippedHeaders,
  "authorization",
] as const;

export function isAgentMailBootstrapPath(path: string): boolean {
  const queryIndex = path.indexOf("?");
  return agentMailBootstrapPaths.has(
    queryIndex === -1 ? path : path.slice(0, queryIndex)
  );
}

export function isAgentMailboxAuthorization(
  value: string | string[] | undefined
): boolean {
  return typeof value === "string" && /^Bearer omb_/i.test(value);
}

export function rewriteAgentMailProxyPath(path: string): string {
  return path.replace(/^\/agent-mail-api\/?/, "/");
}
