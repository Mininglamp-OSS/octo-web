import { describe, it, expect } from "vitest";
import { buildQuickStartTabs, TOKEN_PLACEHOLDER } from "./quickStartTemplates";
import type { McpQuickStart } from "../types/mcp";

/** Small helper: grab a tab's content by key from the ordered tab list. */
function content(qs: McpQuickStart, key: "prompt" | "json"): string {
  const tab = buildQuickStartTabs(qs).find((t) => t.key === key);
  if (!tab) throw new Error(`missing tab ${key}`);
  return tab.content;
}

describe("buildQuickStartTabs — JSON snippet", () => {
  it("stdio: no `type` field, shared env passes through, user-supplied env renders placeholder", () => {
    const qs: McpQuickStart = {
      transport: "stdio",
      serverName: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { FOO: "bar", GITHUB_TOKEN: "" },
      envUserSupplied: ["GITHUB_TOKEN"],
    };
    const json = JSON.parse(content(qs, "json"));
    const server = json.mcpServers.github;
    expect(server.type).toBeUndefined();
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    expect(server.env).toEqual({ FOO: "bar", GITHUB_TOKEN: TOKEN_PLACEHOLDER });
  });

  it("stdio: shared env value is published verbatim (no forced masking)", () => {
    const qs: McpQuickStart = {
      transport: "stdio",
      serverName: "svc",
      command: "npx",
      env: { API_KEY: "shared-service-account" },
    };
    const server = JSON.parse(content(qs, "json")).mcpServers.svc;
    // No headersUserSupplied / envUserSupplied entry → value is trusted-shared.
    expect(server.env).toEqual({ API_KEY: "shared-service-account" });
  });

  it("stdio: omits env when backend returned nothing", () => {
    const qs: McpQuickStart = {
      transport: "stdio",
      serverName: "foo",
      command: "npx",
    };
    const server = JSON.parse(content(qs, "json")).mcpServers.foo;
    expect("env" in server).toBe(false);
  });

  it("stdio: omits env when backend returned an empty map", () => {
    const qs: McpQuickStart = {
      transport: "stdio",
      serverName: "foo",
      command: "npx",
      env: {},
    };
    const server = JSON.parse(content(qs, "json")).mcpServers.foo;
    expect("env" in server).toBe(false);
  });

  it("streamable-http: type=streamable_http, shared header value passes through, user-supplied renders placeholder", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "github",
      url: "https://mcp.example.com/github",
      headers: { "X-Trace": "web", Authorization: "" },
      headersUserSupplied: ["Authorization"],
    };
    const server = JSON.parse(content(qs, "json")).mcpServers.github;
    expect(server.type).toBe("streamable_http");
    expect(server.url).toBe("https://mcp.example.com/github");
    expect(server.headers).toEqual({
      "X-Trace": "web",
      Authorization: TOKEN_PLACEHOLDER,
    });
  });

  it("sse: type=sse", () => {
    const qs: McpQuickStart = {
      transport: "sse",
      serverName: "foo",
      url: "https://x/sse",
    };
    const server = JSON.parse(content(qs, "json")).mcpServers.foo;
    expect(server.type).toBe("sse");
  });

  it("remote: omits headers when there are none", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "foo",
      url: "https://x",
    };
    const server = JSON.parse(content(qs, "json")).mcpServers.foo;
    expect("headers" in server).toBe(false);
  });

  it("json key: slugifies a Chinese display name to an ASCII slug", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "获取天气 MCP",
      url: "https://x",
    };
    const keys = Object.keys(JSON.parse(content(qs, "json")).mcpServers);
    // Chinese chars are dropped; only the ASCII token survives.
    expect(keys).toEqual(["mcp"]);
  });

  it("json key: falls back to mcp-server when the name has no ASCII chars", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "获取天气",
      url: "https://x",
    };
    const keys = Object.keys(JSON.parse(content(qs, "json")).mcpServers);
    expect(keys).toEqual(["mcp-server"]);
  });

  it("json key: an explicit slug overrides the derived one", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "获取天气 MCP",
      slug: "weather",
      url: "https://x",
    };
    const keys = Object.keys(JSON.parse(content(qs, "json")).mcpServers);
    expect(keys).toEqual(["weather"]);
  });

  it("json key: sanitizes a dirty manual slug (Chinese/upper/space/underscore)", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "获取天气 MCP",
      slug: "My Weather_服务 MCP",
      url: "https://x",
    };
    const keys = Object.keys(JSON.parse(content(qs, "json")).mcpServers);
    expect(keys).toEqual(["my-weather-mcp"]);
  });

  it("json key: falls back to safe default when a manual slug slugifies to empty", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "获取天气 MCP",
      slug: "服务器",
      url: "https://x",
    };
    const keys = Object.keys(JSON.parse(content(qs, "json")).mcpServers);
    expect(keys).toEqual(["mcp-server"]);
  });
});

describe("buildQuickStartTabs — prompt", () => {
  it("stdio: renders shared env as-is, user-supplied env as placeholder", () => {
    const qs: McpQuickStart = {
      transport: "stdio",
      serverName: "github",
      command: "npx",
      args: ["-y", "@x/y"],
      env: { FOO: "bar", GITHUB_TOKEN: "" },
      envUserSupplied: ["GITHUB_TOKEN"],
    };
    const prompt = content(qs, "prompt");
    expect(prompt).toContain("FOO=bar");
    expect(prompt).toContain(`GITHUB_TOKEN=${TOKEN_PLACEHOLDER}`);
  });

  it("stdio: skips the env line entirely when env map is empty", () => {
    const qs: McpQuickStart = {
      transport: "stdio",
      serverName: "foo",
      command: "npx",
      env: {},
    };
    expect(content(qs, "prompt")).not.toContain("环境变量");
  });

  it("remote: renders shared header verbatim, user-supplied header as placeholder", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "foo",
      url: "https://x",
      headers: { "X-Trace": "web", Authorization: "" },
      headersUserSupplied: ["Authorization"],
    };
    const prompt = content(qs, "prompt");
    expect(prompt).toContain("X-Trace: web");
    expect(prompt).toContain(`Authorization: ${TOKEN_PLACEHOLDER}`);
  });

  it("remote: skips 请求头 line when no headers", () => {
    const qs: McpQuickStart = {
      transport: "streamable-http",
      serverName: "foo",
      url: "https://x",
    };
    const prompt = content(qs, "prompt");
    expect(prompt).not.toContain("请求头");
  });
});
