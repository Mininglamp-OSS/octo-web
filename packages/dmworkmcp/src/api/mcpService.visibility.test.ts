import { describe, expect, it } from "vitest";
import { placeholderFor, placeholderSecretMap, toPluginUpsert } from "./mcpWireParams";
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
    // Cross-repo contract: the write path must emit the 2.0 schema ids the
    // unified backend requires (a 1.0 id is hard-rejected). Pin them so a
    // regression turns a production 400 into a red test.
    expect(body.plugin.manifest_json.$schema).toBe("cowork-plugin-manifest-2.0.json");
    expect(body.plugin.plugin_json.$schema).toBe("cowork-plugin-package-2.0.json");
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
    // mcpServers MUST be keyed by the ASCII slug, not the display name — a
    // space/CJK display-name key breaks the copy-paste config and disagrees
    // with manifest.name / connector.source (both slug).
    expect(Object.keys(doc.mcpServers)).toEqual(["github-mcp"]);
    expect(doc.mcpServers["GitHub MCP"]).toBeUndefined();
    const server = doc.mcpServers["github-mcp"];
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

  it("keys mcpServers by the default slug when the name has no ASCII slug", () => {
    const cjk: CreateMcpParams = { ...form, name: "高德地图", slug: undefined };
    const body = toPluginUpsert(cjk, { visibility: "space" });
    const doc = JSON.parse(
      rawAttachment(body.plugin.plugin_json, "mcp.json") ?? "{}"
    );
    // A pure-CJK display name slugifies to empty → the shared default slug; the
    // key must never be the raw Chinese name.
    expect(Object.keys(doc.mcpServers)).toEqual(["mcp-server"]);
    expect(doc.mcpServers["高德地图"]).toBeUndefined();
    expect(body.plugin.plugin_json.connector.source).toBe("connector.mcp-server");
    expect(body.plugin.manifest_json.name).toBe("mcp-server");
  });

  it("does not embed a manifest.json attachment (contract layout)", () => {
    const body = toPluginUpsert(form, { visibility: "space" });
    expect(rawAttachment(body.plugin.plugin_json, "manifest.json")).toBeUndefined();
    expect(
      body.plugin.plugin_json.attachments.some((a) => a.path === "manifest.json")
    ).toBe(false);
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

describe("secret placeholder round-trip — preserves the original reference", () => {
  it("writes back ${SHARED_TOKEN} under key TOKEN unchanged (no rename to ${TOKEN})", () => {
    // A cross-referential ${SHARED_TOKEN} is NOT a self-referential fill-in slot,
    // so the reader keeps it verbatim (not blanked, not user-supplied)...
    const read = splitUserSupplied({ TOKEN: "${SHARED_TOKEN}" });
    expect(read.userSupplied).toBeUndefined();
    expect(read.values).toEqual({ TOKEN: "${SHARED_TOKEN}" });

    // ...and the writer echoes it through unchanged rather than renaming it.
    const written = placeholderSecretMap(read.values, read.userSupplied);
    expect(written).toEqual({ TOKEN: "${SHARED_TOKEN}" });
  });

  it("blanks and regenerates the self-referential ${KEY} slot stably", () => {
    // A genuine user-supplied key reads as blank + user-supplied and the writer
    // regenerates the identical ${KEY}, round-tripping without change.
    const read = splitUserSupplied({ TOKEN: "${TOKEN}" });
    expect(read.userSupplied).toEqual(["TOKEN"]);
    expect(read.values).toEqual({ TOKEN: "" });
    expect(placeholderSecretMap(read.values, read.userSupplied)).toEqual({
      TOKEN: "${TOKEN}",
    });
  });

  it("blanks the backend redaction sentinel on read and never re-emits it on write", () => {
    // The backend echoes SECRET_PLACEHOLDER for a redacted value. Read blanks it
    // to "" (not user-supplied — it is a shared key), and the write path also
    // maps the sentinel to "" so it is never sent back (the upsert would reject
    // it under a secret-named key). Neither branch can preserve the stored value
    // — the design has no "leave untouched" path, which this pins.
    const read = splitUserSupplied({ SHARED_TOKEN: SECRET_PLACEHOLDER });
    expect(read.userSupplied).toBeUndefined();
    expect(read.values).toEqual({ SHARED_TOKEN: "" });
    // Even if the sentinel somehow reached the write path directly, it blanks.
    expect(placeholderSecretMap({ SHARED_TOKEN: SECRET_PLACEHOLDER }, undefined)).toEqual({
      SHARED_TOKEN: "",
    });
  });
});

// createMcp used to hardcode `visibility: "private"`, discarding whatever the
// author declared — which is the single regression this whole change is
// vulnerable to, because the declared value is exactly what the backend reads to
// decide whether 发布 lists the connector or opens an organization review.
// Flattening it here would silently make every connector private-only again, and
// nothing downstream would complain.
describe("createMcp visibility", () => {
  it("forwards the declared audience instead of flattening it to private", () => {
    const body = toPluginUpsert({ ...form, visibility: "space" }, {
      categoryId: "cat-1",
      visibility: "space",
    });
    expect(body.plugin.visibility).toBe("space");
  });

  it("falls back to private when the caller declares nothing", () => {
    const body = toPluginUpsert(form, { categoryId: "cat-1", visibility: "private" });
    expect(body.plugin.visibility).toBe("private");
  });
});
