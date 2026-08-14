export const agentMailProxyContext = "^/agent-mail-api(?:[/?]|$)";

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

export function isAgentMailboxAuthorization(
  value: string | string[] | undefined
): boolean {
  return typeof value === "string" && /^Bearer omb_/i.test(value);
}

export function rewriteAgentMailProxyPath(path: string): string {
  return path.replace(/^\/agent-mail-api\/?/, "/");
}
