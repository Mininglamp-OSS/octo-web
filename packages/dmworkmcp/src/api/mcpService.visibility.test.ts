import { describe, expect, it } from "vitest";
import { placeholderFor, toPluginUpsert } from "./mcpWireParams";
import { splitUserSupplied } from "./pluginWire";
import { SECRET_PLACEHOLDER, goCanonicalJSON, rawAttachment } from "./pluginWire";
import type { CreateMcpParams } from "../types/mcp";

const form: CreateMcpParams = {
  name: "GitHub MCP",
  slug: "github-mcp",
  category: "dev",
  icon: "🐙",
  tags: [" official ", "official", "hot"],
  slogan: "Issues and pull requests",
  transport: "streamable-http",
  url: "https://mcp.example.com/github",
  headers: { Authorization: "Bearer real-token", "X-Trace": "on" },
  headersUserSupplied: ["Authorization"],
  env: { REGION: "us", DB_URI: SECRET_PLACEHOLDER },
  tools: [{ name: "list_repos", description: "列出仓库" }],
  usageExamples: [" 查询 issue ", ""],
  faqs: [{ question: "如何鉴权?", answer: "填 token" }],
  notes: ["注意配额"],
};

describe("toPluginUpsert", () => {
  it("builds a connector upsert with the caller-provided visibility", () => {
    const body = toPluginUpsert(form, { categoryId: "cat-1", visibility: "space" });
    expect(body.plugin.plugin_type).toBe("connector");
    expect(body.plugin.visibility).toBe("space");
    expect(body.plugin.category_id).toBe("cat-1");
    expect(body.plugin.icon).toBe("🐙");
    expect(body.plugin.tags).toEqual(["official", "hot"]);
    expect(body.plugin.manifest_json.labels).toEqual(["official", "hot"]);
    expect(body.plugin.manifest_json.name).toBe("github-mcp");
    expect(body.relations).toEqual([]);
  });

  it("targets an existing plugin when pluginId is set", () => {
    const body = toPluginUpsert(form, { pluginId: "plugin-1", visibility: "private" });
    expect(body.plugin.plugin_id).toBe("plugin-1");
    expect(body.plugin.visibility).toBe("private");
  });

  it("writes ${KEY} placeholders for user-supplied keys and blanks sentinels", () => {
    const body = toPluginUpsert(form, { visibility: "space" });
    expect(body.plugin.plugin_json.connector).toEqual({
      type: "mcp",
      source: "connector.github-mcp",
    });
    const doc = JSON.parse(
      rawAttachment(body.plugin.plugin_json, "mcp.json") ?? "{}"
    );
    const server = doc.mcpServers["GitHub MCP"];
    expect(server.type).toBe("streamable-http");
    expect(server.url).toBe("https://mcp.example.com/github");
    // User-supplied Authorization becomes an install-time placeholder; the
    // redaction sentinel echoed under DB_URI is blanked, plain values pass.
    expect(server.headers).toEqual({
      Authorization: "${AUTHORIZATION}",
      "X-Trace": "on",
    });
    expect(server.env).toEqual({ REGION: "us", DB_URI: "" });
  });

  it("embeds a manifest.json attachment byte-equal to the submitted manifest", () => {
    const body = toPluginUpsert(form, { visibility: "space" });
    const embedded = rawAttachment(body.plugin.plugin_json, "manifest.json");
    expect(embedded).toBe(goCanonicalJSON(body.plugin.manifest_json));
  });

  it("carries examples, faqs, and notes as connector attachments", () => {
    const body = toPluginUpsert(form, { visibility: "space" });
    expect(
      JSON.parse(rawAttachment(body.plugin.plugin_json, "connector/examples.json") ?? "[]")
    ).toEqual(["查询 issue"]);
    expect(
      JSON.parse(rawAttachment(body.plugin.plugin_json, "connector/tools.json") ?? "[]")
    ).toEqual([{ name: "list_repos", description: "列出仓库" }]);
    expect(
      JSON.parse(rawAttachment(body.plugin.plugin_json, "connector/notes.json") ?? "[]")
    ).toEqual(["注意配额"]);
  });
});

describe("goCanonicalJSON — Go json.Marshal parity", () => {
  it("sorts object keys and strips whitespace", () => {
    expect(goCanonicalJSON({ b: 1, a: "x" })).toBe('{"a":"x","b":1}');
  });

  it("escapes <, >, & the way Go's default encoder does", () => {
    expect(goCanonicalJSON({ s: "<a & b>" })).toBe(
      '{"s":"\\u003ca \\u0026 b\\u003e"}'
    );
  });

  it("keeps CJK text unescaped like Go", () => {
    expect(goCanonicalJSON({ s: "使用示例 1" })).toBe('{"s":"使用示例 1"}');
  });
});

describe("splitUserSupplied — placeholder read path", () => {
  it("round-trips every placeholderFor output, including digit-leading keys", () => {
    // The writer normalizes keys like "12" to ${12}; the reader must accept
    // the same range or the user-supplied marker is silently lost on read.
    for (const key of ["Authorization", "X-API-Key", "12", "1Password", "数据库"]) {
      const split = splitUserSupplied({ [key]: placeholderFor(key) });
      expect(split.userSupplied).toEqual([key]);
      expect(split.values).toEqual({ [key]: "" });
    }
  });

  it("keeps distinct keys separate even when their placeholders collide", () => {
    const split = splitUserSupplied({
      "X-API-Key": placeholderFor("X-API-Key"),
      X_API_Key: placeholderFor("X_API_Key"),
    });
    expect(split.userSupplied).toEqual(["X-API-Key", "X_API_Key"]);
    expect(split.values).toEqual({ "X-API-Key": "", X_API_Key: "" });
  });

  it("passes plain literals through and blanks redaction sentinels only", () => {
    const split = splitUserSupplied({
      REGION: "us",
      NOT_A_PLACEHOLDER: "${not a name}",
    });
    expect(split.userSupplied).toBeUndefined();
    expect(split.values).toEqual({
      REGION: "us",
      NOT_A_PLACEHOLDER: "${not a name}",
    });
  });
});
