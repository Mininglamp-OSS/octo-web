import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentMailBootstrapStrippedHeaders,
  agentMailProxyContext,
  agentMailProxyStrippedHeaders,
  browserMailProxyStrippedHeaders,
  isAgentMailBootstrapPath,
  isAgentMailboxAuthorization,
  rewriteAgentMailProxyPath,
} from "../mailProxy";

type ProxyResult =
  | { matched: false }
  | { matched: true; status: 401 }
  | { matched: true; status: 200; upstreamPath: string };

function viteProxyResult(
  requestUrl: string,
  authorization = "Bearer omb_test"
): ProxyResult {
  if (!new RegExp(agentMailProxyContext).test(requestUrl)) {
    return { matched: false };
  }
  if (
    !isAgentMailBootstrapPath(requestUrl) &&
    !isAgentMailboxAuthorization(authorization)
  ) {
    return { matched: true, status: 401 };
  }
  return {
    matched: true,
    status: 200,
    upstreamPath: rewriteAgentMailProxyPath(requestUrl),
  };
}

function nginxProxyResult(
  requestUrl: string,
  authorization = "Bearer omb_test"
): ProxyResult {
  const queryIndex = requestUrl.indexOf("?");
  const uri = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : requestUrl.slice(queryIndex);
  if (!/^\/agent-mail-api(?:\/|$)/.test(uri)) {
    return { matched: false };
  }
  if (
    !isAgentMailBootstrapPath(requestUrl) &&
    !isAgentMailboxAuthorization(authorization)
  ) {
    return { matched: true, status: 401 };
  }
  return {
    matched: true,
    status: 200,
    upstreamPath: `${uri.replace(/^\/agent-mail-api\/?/, "/")}${query}`,
  };
}

function forwardedHeaders(
  input: Record<string, string>,
  strippedHeaders: readonly string[]
): Record<string, string> {
  const stripped = new Set(
    strippedHeaders.map((header) => header.toLowerCase())
  );
  return Object.fromEntries(
    Object.entries(input).filter(
      ([header]) => !stripped.has(header.toLowerCase())
    )
  );
}

describe("Agent Mail proxy path parity", () => {
  it.each([
    ["/agent-mail-api", { matched: true, status: 200, upstreamPath: "/" }],
    ["/agent-mail-api/", { matched: true, status: 200, upstreamPath: "/" }],
    [
      "/agent-mail-api/v1/messages",
      { matched: true, status: 200, upstreamPath: "/v1/messages" },
    ],
    [
      "/agent-mail-api/v1/messages?x=1",
      {
        matched: true,
        status: 200,
        upstreamPath: "/v1/messages?x=1",
      },
    ],
    [
      "/agent-mail-api?x=1",
      { matched: true, status: 200, upstreamPath: "/?x=1" },
    ],
    ["/agent-mail-apix", { matched: false }],
  ])(
    "keeps dev and production behavior aligned for %s",
    (requestUrl, expected) => {
      expect(viteProxyResult(requestUrl)).toEqual(expected);
      expect(nginxProxyResult(requestUrl)).toEqual(expected);
    }
  );

  it.each(["", "Basic abc", "Bearer user-token"])(
    "rejects a missing or non-mailbox credential in both environments: %s",
    (authorization) => {
      const expected = { matched: true, status: 401 };
      expect(viteProxyResult("/agent-mail-api/health", authorization)).toEqual(
        expected
      );
      expect(nginxProxyResult("/agent-mail-api/health", authorization)).toEqual(
        expected
      );
    }
  );

  it.each([
    [
      "/agent-mail-api/webapi/v0/agent-auth/device",
      "/webapi/v0/agent-auth/device",
    ],
    [
      "/agent-mail-api/webapi/v0/agent-auth/token?attempt=1",
      "/webapi/v0/agent-auth/token?attempt=1",
    ],
  ])(
    "allows the exact unauthenticated authorization bootstrap route: %s",
    (requestUrl, upstreamPath) => {
      const expected = { matched: true, status: 200, upstreamPath };
      expect(viteProxyResult(requestUrl, "")).toEqual(expected);
      expect(nginxProxyResult(requestUrl, "")).toEqual(expected);
    }
  );

  it("does not widen the bootstrap exception to neighboring paths", () => {
    const requestUrl = "/agent-mail-api/webapi/v0/agent-auth/device/anything";
    const expected = { matched: true, status: 401 };
    expect(viteProxyResult(requestUrl, "")).toEqual(expected);
    expect(nginxProxyResult(requestUrl, "")).toEqual(expected);
  });

  it("recognizes the exact bootstrap path after the Vite proxy rewrite", () => {
    expect(isAgentMailBootstrapPath("/webapi/v0/agent-auth/device")).toBe(true);
    expect(
      isAgentMailBootstrapPath("/webapi/v0/agent-auth/token?attempt=1")
    ).toBe(true);
    expect(
      isAgentMailBootstrapPath("/webapi/v0/agent-auth/device/anything")
    ).toBe(false);
  });

  it("strips browser and Agent credentials at the same boundaries as Nginx", () => {
    const headers = {
      Authorization: "Bearer omb_secret",
      Cookie: "octo=session",
      token: "user-token",
      "X-Space-ID": "space-1",
      "X-Octo-Mailbox-ID": "42",
      "X-Request-ID": "request-1",
    };

    expect(forwardedHeaders(headers, browserMailProxyStrippedHeaders)).toEqual({
      token: "user-token",
      "X-Space-ID": "space-1",
      "X-Octo-Mailbox-ID": "42",
      "X-Request-ID": "request-1",
    });
    expect(forwardedHeaders(headers, agentMailProxyStrippedHeaders)).toEqual({
      Authorization: "Bearer omb_secret",
      "X-Request-ID": "request-1",
    });
    expect(
      forwardedHeaders(headers, agentMailBootstrapStrippedHeaders)
    ).toEqual({
      "X-Request-ID": "request-1",
    });
  });

  it("keeps the production Nginx location and rewrite directives aligned", () => {
    const repositoryRoot = path.resolve(__dirname, "../../../..");
    const nginx = fs.readFileSync(
      path.join(repositoryRoot, "nginx.conf.template"),
      "utf8"
    );

    const bootstrapLocation =
      "location ~ ^/agent-mail-api/webapi/v0/agent-auth/(device|token)$";
    const credentialedLocation = "location ~ ^/agent-mail-api(?:/|$)";
    expect(nginx).toContain(bootstrapLocation);
    expect(nginx).toContain(credentialedLocation);
    expect(nginx.indexOf(bootstrapLocation)).toBeLessThan(
      nginx.indexOf(credentialedLocation)
    );
    expect(nginx).toContain("rewrite ^/agent-mail-api/?(.*)$ /$1 break;");
    expect(nginx).toContain('if ($agent_mail_authorization = "")');
    expect(nginx).toContain('proxy_set_header Authorization "";');
    expect(nginx).toContain('proxy_set_header Cookie "";');
    expect(nginx).toContain(
      "proxy_set_header Authorization $agent_mail_authorization;"
    );
  });
});
