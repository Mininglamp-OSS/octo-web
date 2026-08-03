import { describe, it, expect } from "vitest";
import { parseImportJSON } from "./importJson";

describe("parseImportJSON — fatal errors", () => {
  it("empty string → error empty", () => {
    expect(parseImportJSON("").error).toBe("mcp.create.import.error.empty");
    expect(parseImportJSON("   \n  ").error).toBe(
      "mcp.create.import.error.empty"
    );
  });

  it("invalid JSON → error invalidJson", () => {
    expect(parseImportJSON("{ not json }").error).toBe(
      "mcp.create.import.error.invalidJson"
    );
    expect(parseImportJSON("[").error).toBe(
      "mcp.create.import.error.invalidJson"
    );
  });

  it("array / primitive top-level → error notObject", () => {
    expect(parseImportJSON("[]").error).toBe(
      "mcp.create.import.error.notObject"
    );
    expect(parseImportJSON('"str"').error).toBe(
      "mcp.create.import.error.notObject"
    );
    expect(parseImportJSON("42").error).toBe(
      "mcp.create.import.error.notObject"
    );
    expect(parseImportJSON("null").error).toBe(
      "mcp.create.import.error.notObject"
    );
  });

  it("mcpServers not an object → error mcpServersInvalid", () => {
    expect(parseImportJSON('{"mcpServers":[]}').error).toBe(
      "mcp.create.import.error.mcpServersInvalid"
    );
    expect(parseImportJSON('{"mcpServers":"x"}').error).toBe(
      "mcp.create.import.error.mcpServersInvalid"
    );
  });

  it("empty mcpServers → error mcpServersEmpty", () => {
    expect(parseImportJSON('{"mcpServers":{}}').error).toBe(
      "mcp.create.import.error.mcpServersEmpty"
    );
  });

  it("server config not object → error serverConfigInvalid", () => {
    expect(parseImportJSON('{"mcpServers":{"foo":"bar"}}').error).toBe(
      "mcp.create.import.error.serverConfigInvalid"
    );
  });

  it("object with no known fields → error unknownFormat", () => {
    expect(parseImportJSON('{"foo":1,"bar":2}').error).toBe(
      "mcp.create.import.error.unknownFormat"
    );
  });

  it("flat with only unknown fields → error noRecognizedFields", () => {
    // Has "transport" (looksLikeFlat) but no name/command/url.
    expect(parseImportJSON('{"transport":"stdio"}').error).toBe(
      "mcp.create.import.error.noRecognizedFields"
    );
  });
});

describe("parseImportJSON — mcpServers format (Claude Desktop / Cursor)", () => {
  it("stdio: extracts command, args, env keys, and infers transport=stdio", () => {
    const input = JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "<YOUR_TOKEN>" },
        },
      },
    });
    const r = parseImportJSON(input);
    expect(r.error).toBeUndefined();
    expect(r.fields).toEqual({
      name: "github",
      slug: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
      transport: "stdio",
    });
    // Placeholder value `<YOUR_TOKEN>` must NOT trigger the "values dropped" warning.
    expect(r.warnings).toEqual([]);
  });

  it("wrapper key is authoritative slug; overrides inner name", () => {
    const input = JSON.stringify({
      mcpServers: {
        "my-github": {
          name: "GitHub Official",
          command: "npx",
          args: [],
        },
      },
    });
    const r = parseImportJSON(input);
    expect(r.fields.slug).toBe("my-github");
    // Inner name still wins for display when present.
    expect(r.fields.name).toBe("GitHub Official");
  });

  it("wrapper key is slugified before write (@scope/name → ascii slug)", () => {
    const input = JSON.stringify({
      mcpServers: {
        "@modelcontextprotocol/server-github": {
          command: "npx",
          args: [],
        },
      },
    });
    const r = parseImportJSON(input);
    // slugifyServerName strips "@", "/", etc.
    expect(r.fields.slug).toBe("modelcontextprotocolserver-github");
    // Name display retains the raw key (that's how a human spells it).
    expect(r.fields.name).toBe("@modelcontextprotocol/server-github");
  });

  it("all-non-ascii wrapper key falls back to DEFAULT_SERVER_SLUG", () => {
    const input = JSON.stringify({
      mcpServers: { 我的服务: { command: "npx" } },
    });
    const r = parseImportJSON(input);
    expect(r.fields.slug).toBe("mcp-server");
    expect(r.fields.name).toBe("我的服务");
  });

  it("uses wrapper key as name when inner has none", () => {
    const input = JSON.stringify({
      mcpServers: {
        filesystem: { command: "npx", args: ["-y", "@x/fs"] },
      },
    });
    expect(parseImportJSON(input).fields.name).toBe("filesystem");
  });

  it("multiple servers → takes first, warns", () => {
    const input = JSON.stringify({
      mcpServers: {
        a: { command: "npx" },
        b: { command: "uvx" },
      },
    });
    const r = parseImportJSON(input);
    expect(r.fields.slug).toBe("a");
    expect(r.fields.command).toBe("npx");
    expect(r.warnings).toContain("mcp.create.import.warning.multipleServers");
  });

  it("real env values → warns valuesDropped, still returns only keys", () => {
    const input = JSON.stringify({
      mcpServers: {
        x: {
          command: "npx",
          env: { API_KEY: "sk-real-token-abc123" },
        },
      },
    });
    const r = parseImportJSON(input);
    expect(r.fields.envKeys).toEqual(["API_KEY"]);
    expect(r.warnings).toContain(
      "mcp.create.import.warning.envValuesDropped"
    );
  });

  it("placeholder-shaped env values → no warning", () => {
    const cases = [
      "<TOKEN>",
      "${API_KEY}",
      "your-api-key",
      "YOUR_TOKEN_HERE",
      "  ",
      "",
    ];
    for (const placeholder of cases) {
      const input = JSON.stringify({
        mcpServers: {
          x: { command: "npx", env: { API_KEY: placeholder } },
        },
      });
      const r = parseImportJSON(input);
      expect(r.warnings, `placeholder=${placeholder}`).toEqual([]);
    }
  });

  it("remote (http-like) transport: infers streamable-http from url", () => {
    const input = JSON.stringify({
      mcpServers: {
        api: {
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer <TOKEN>" },
        },
      },
    });
    const r = parseImportJSON(input);
    expect(r.fields.transport).toBe("streamable-http");
    expect(r.fields.url).toBe("https://mcp.example.com/sse");
    expect(r.fields.headerKeys).toEqual(["Authorization"]);
    expect(r.warnings).toEqual([]);
  });

  it("explicit transport type=sse overrides inference", () => {
    const input = JSON.stringify({
      mcpServers: {
        api: { url: "https://x/sse", type: "sse" },
      },
    });
    expect(parseImportJSON(input).fields.transport).toBe("sse");
  });

  it('explicit transport "http" maps to streamable-http', () => {
    const input = JSON.stringify({
      mcpServers: { api: { url: "https://x", transport: "http" } },
    });
    expect(parseImportJSON(input).fields.transport).toBe("streamable-http");
  });

  it("args accepts numbers and booleans, drops object items", () => {
    const input = JSON.stringify({
      mcpServers: {
        x: { command: "node", args: ["a", 1, true, { bad: 1 }, "b"] },
      },
    });
    expect(parseImportJSON(input).fields.args).toEqual([
      "a",
      "1",
      "true",
      "b",
    ]);
  });

  it("args drops empty / whitespace-only entries", () => {
    const input = JSON.stringify({
      mcpServers: {
        x: {
          command: "node",
          args: ["--config", "", "  ", "\t", "--verbose"],
        },
      },
    });
    // Empty / whitespace tokens would otherwise create blank lines in argsRaw
    // that the submit-side filter(Boolean) silently drops — filtering here
    // keeps the round-trip lossless.
    expect(parseImportJSON(input).fields.args).toEqual([
      "--config",
      "--verbose",
    ]);
  });

  it("args as non-array is ignored (undefined, not error)", () => {
    const input = JSON.stringify({
      mcpServers: { x: { command: "npx", args: "not-an-array" } },
    });
    const r = parseImportJSON(input);
    expect(r.error).toBeUndefined();
    expect(r.fields.args).toBeUndefined();
    expect(r.fields.command).toBe("npx");
  });
});

describe("parseImportJSON — flat server.json-ish format", () => {
  it("extracts flat fields", () => {
    const input = JSON.stringify({
      name: "postgres",
      command: "uvx",
      args: ["mcp-server-postgres"],
      env: { POSTGRES_URL: "" },
      transport: "stdio",
    });
    const r = parseImportJSON(input);
    expect(r.error).toBeUndefined();
    expect(r.fields).toEqual({
      name: "postgres",
      command: "uvx",
      args: ["mcp-server-postgres"],
      envKeys: ["POSTGRES_URL"],
      transport: "stdio",
    });
    expect(r.fields.slug).toBeUndefined(); // no wrapper key
  });

  it("infers transport=streamable-http from url on flat", () => {
    const r = parseImportJSON(
      JSON.stringify({ name: "remote", url: "https://x.example/mcp" })
    );
    expect(r.fields.transport).toBe("streamable-http");
    expect(r.fields.url).toBe("https://x.example/mcp");
  });

  it("infers transport=stdio from command on flat", () => {
    const r = parseImportJSON(JSON.stringify({ command: "node index.js" }));
    expect(r.fields.transport).toBe("stdio");
  });
});

describe("parseImportJSON — Format C (single-key wrapper, vendor exports)", () => {
  // Real payload from a mixreach export — mcpServers wrapper omitted,
  // transport aliased as `protocol_type`, value uses underscore.
  it("mixreach-style: single-key wrapper + protocol_type + streamable_http", () => {
    const raw = JSON.stringify({
      "mixreach-mcp-tools": {
        url: "https://open-api-mixreach.cn.miaozhen.com/mcp_server/mcp/",
        headers: { Authorization: "Bearer jajJJDHqIEJDKkkk" },
        protocol_type: "streamable_http",
      },
    });
    const r = parseImportJSON(raw);
    expect(r.error).toBeUndefined();
    expect(r.fields.name).toBe("mixreach-mcp-tools");
    expect(r.fields.slug).toBe("mixreach-mcp-tools");
    expect(r.fields.url).toBe(
      "https://open-api-mixreach.cn.miaozhen.com/mcp_server/mcp/"
    );
    expect(r.fields.headerKeys).toEqual(["Authorization"]);
    expect(r.fields.transport).toBe("streamable-http");
    // Real header value → the "values dropped" warning fires so the user
    // knows the Bearer token wasn't imported.
    expect(r.warnings).toContain(
      "mcp.create.import.warning.headerValuesDropped"
    );
  });

  it("multiple single-key entries → first wins + multipleServers warning", () => {
    const raw = JSON.stringify({
      first: { url: "https://a", type: "streamable-http" },
      second: { url: "https://b", type: "sse" },
    });
    const r = parseImportJSON(raw);
    expect(r.error).toBeUndefined();
    expect(r.fields.name).toBe("first");
    expect(r.fields.url).toBe("https://a");
    expect(r.warnings).toContain(
      "mcp.create.import.warning.multipleServers"
    );
  });

  it("top-level non-server entries don't false-positive as Format C", () => {
    // A JSON blob whose top-level values are primitives or unrelated objects
    // should NOT be interpreted as a single-key wrapper.
    const r = parseImportJSON(
      JSON.stringify({ someRandom: "just a string" })
    );
    expect(r.error).toBe("mcp.create.import.error.unknownFormat");
  });

  it("`type` also accepts the underscore variant streamable_http", () => {
    const r = parseImportJSON(
      JSON.stringify({ url: "https://x", type: "streamable_http" })
    );
    expect(r.fields.transport).toBe("streamable-http");
  });
});
