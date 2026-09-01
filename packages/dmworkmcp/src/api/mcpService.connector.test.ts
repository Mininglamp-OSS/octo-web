import { describe, expect, it, vi, beforeEach } from "vitest";

// mcpService creates its own axios instance at module load (with request /
// response interceptors), so mock the factory and drive `.get` / `.post` per
// request path. Mirrors expertService.listSort.test.ts's hoisted axios mock.
const mock = vi.hoisted(() => ({
  logout: vi.fn(),
  instance: {
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("axios", () => ({
  default: {
    create: () => mock.instance,
    isCancel: () => false,
  },
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    apiClient: { config: { apiURL: "/api/v1/" } },
    loginInfo: { token: "tok" },
    shared: { currentSpaceId: "sp", logout: mock.logout },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { createMcp, updateMcp, fetchMcpList } from "./mcpService";
import { WKApp } from "@octo/base";
import type { CreateMcpParams } from "../types/mcp";

const CATEGORIES = [
  { category_id: "c-dev", name: "dev", plugin_count: 2, sort_order: 0 },
];

/** `/plugin_categories` reads flow through get<T>() → resp.data.data. */
function categoriesOk(wire = CATEGORIES) {
  return { data: { data: wire } };
}

function baseParams(overrides: Partial<CreateMcpParams> = {}): CreateMcpParams {
  return {
    name: "GitHub MCP",
    slug: "github-mcp",
    category: "dev",
    icon: "🐙",
    tags: ["hot"],
    slogan: "Issues and PRs",
    transport: "streamable-http",
    url: "https://mcp.example.com/github",
    tools: [{ name: "list_repos", description: "list" }],
    ...overrides,
  };
}

/** Minimal detail plugin the mappers can project without crashing. */
function detailPlugin(overrides: Record<string, unknown> = {}) {
  return {
    plugin: {
      plugin_id: "p-1",
      plugin_name: "GitHub MCP",
      plugin_type: "connector",
      category_id: "c-dev",
      tags: ["hot"],
      visibility: "space",
      icon: "icons/obj-key.png",
      icon_url: "https://cdn.example.com/presigned/obj-key.png?exp=1",
      manifest_json: { name: "github-mcp", description: "Issues and PRs" },
      plugin_json: { $schema: "cowork-plugin-package-1.0.json", attachments: [] },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      ...overrides,
    },
    relations: [],
  };
}

let spaceCounter = 0;

beforeEach(() => {
  mock.instance.get.mockReset();
  mock.instance.post.mockReset();
  mock.instance.delete.mockReset();
  // Bust the per-Space category cache between tests by rotating the Space id.
  WKApp.shared.currentSpaceId = `sp-${spaceCounter++}`;
});

describe("fetchMcpListPath — category resolution fails closed (P1-2)", () => {
  it("returns an explicit empty result (never widens) when the category filter is unresolved", async () => {
    mock.instance.get.mockImplementation((url: string) => {
      if (url.includes("/plugin_categories")) return Promise.resolve(categoriesOk());
      throw new Error(`unexpected GET ${url}`);
    });

    const res = await fetchMcpList({ category: "data" });

    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    // The list request must NOT run unfiltered — only the categories were fetched.
    const listCalls = mock.instance.get.mock.calls.filter(
      (c) => (c[0] as string).endsWith("/plugins")
    );
    expect(listCalls).toHaveLength(0);
    // Pills are still returned so the user can switch away.
    expect(res.categories.some((c) => c.key === "dev")).toBe(true);
  });

  it("sends the resolved category_id for a known category", async () => {
    mock.instance.get.mockImplementation((url: string) => {
      if (url.includes("/plugin_categories")) return Promise.resolve(categoriesOk());
      if (url.endsWith("/plugins")) {
        return Promise.resolve({
          data: { data: [], pagination: { total: 0, page: 1, page_size: 20 } },
        });
      }
      throw new Error(`unexpected GET ${url}`);
    });

    await fetchMcpList({ category: "dev" });

    const listCall = mock.instance.get.mock.calls.find((c) =>
      (c[0] as string).endsWith("/plugins")
    ) as [string, { params: Record<string, unknown> }];
    expect(listCall[1].params.category_id).toBe("c-dev");
  });
});

describe("createMcpReal — fail-closed category (P1-9), placement is server-side", () => {
  it("upserts with the resolved category and never calls a separate publish", async () => {
    mock.instance.get.mockResolvedValue(categoriesOk());
    mock.instance.post.mockImplementation((url: string) => {
      if (url.endsWith("/plugins/upsert")) {
        return Promise.resolve({ data: { data: { plugin: { plugin_id: "new-2" } } } });
      }
      // The create flow is a single upsert now — the backend attaches the
      // default placement and snapshots the version in the same write. Any
      // /plugins/publish call would be a regression.
      throw new Error(`unexpected POST ${url}`);
    });

    const res = await createMcp(baseParams());

    expect(res.id).toBe("new-2");
    const upsertCall = mock.instance.post.mock.calls.find((c) =>
      (c[0] as string).endsWith("/plugins/upsert")
    ) as [string, { plugin: { category_id?: string } }];
    expect(upsertCall[1].plugin.category_id).toBe("c-dev");
    const publishCalls = mock.instance.post.mock.calls.filter((c) =>
      (c[0] as string).endsWith("/plugins/publish")
    );
    expect(publishCalls).toHaveLength(0);
  });

  it("throws (and never upserts) when the category cannot be resolved even after a refetch", async () => {
    // Categories never contain the requested key; resolveWriteCategory refetches
    // once then fails closed.
    mock.instance.get.mockResolvedValue(
      categoriesOk([{ category_id: "c-dev", name: "dev", plugin_count: 0, sort_order: 0 }])
    );
    mock.instance.post.mockRejectedValue(new Error("should not be called"));

    await expect(createMcp(baseParams({ category: "ghost" }))).rejects.toThrow();

    const upsertCalls = mock.instance.post.mock.calls.filter((c) =>
      (c[0] as string).endsWith("/plugins/upsert")
    );
    expect(upsertCalls).toHaveLength(0);
  });

  it("rejects an empty category up front — no refetch, no upsert (P1-3)", async () => {
    // A blank category (the modal's degraded '' when category_id is unresolved)
    // must fail closed immediately rather than falling into the refetch path.
    mock.instance.get.mockResolvedValue(categoriesOk());
    mock.instance.post.mockRejectedValue(new Error("should not be called"));

    await expect(createMcp(baseParams({ category: "" }))).rejects.toThrow();

    const upsertCalls = mock.instance.post.mock.calls.filter((c) =>
      (c[0] as string).endsWith("/plugins/upsert")
    );
    expect(upsertCalls).toHaveLength(0);
    // The category GET fires at most once (initial load); no second refetch.
    const categoryGets = mock.instance.get.mock.calls.filter((c) =>
      (c[0] as string).includes("/plugin_categories")
    );
    expect(categoryGets.length).toBeLessThanOrEqual(1);
  });
});

describe("updateMcpReal — icon write intent uses an undefined sentinel (P1-1 / P1-2)", () => {
  function seedGets() {
    mock.instance.get.mockImplementation((url: string) => {
      if (url.includes("/plugin_categories")) return Promise.resolve(categoriesOk());
      if (url.includes("/plugins/detail")) return Promise.resolve({ data: { data: detailPlugin() } });
      throw new Error(`unexpected GET ${url}`);
    });
    mock.instance.post.mockResolvedValue({ data: { data: detailPlugin() } });
  }

  function upsertIcon(): string {
    const upsertCall = mock.instance.post.mock.calls.find((c) =>
      (c[0] as string).endsWith("/plugins/upsert")
    ) as [string, { plugin: { icon: string } }];
    return upsertCall[1].plugin.icon;
  }

  it("echoes the write-canonical current.plugin.icon when the icon is untouched (undefined)", async () => {
    seedGets();

    // Untouched edit: the modal sends `icon: undefined` (NOT the seeded display
    // value). The service must echo the canonical object key.
    await updateMcp("p-1", baseParams({ icon: undefined }));

    // Must be the canonical `icon` column, NOT the expiring presigned
    // `icon_url` (https://cdn.example.com/presigned/obj-key.png?exp=1). A
    // regression that echoed the display value would fail this exact assertion.
    expect(upsertIcon()).toBe("icons/obj-key.png");
  });

  it("writes an empty string through when the icon is cleared", async () => {
    seedGets();

    // handleIconRemove → the modal sends `icon: ""`.
    await updateMcp("p-1", baseParams({ icon: "" }));

    expect(upsertIcon()).toBe("");
  });

  it("writes a freshly-picked icon key through unchanged", async () => {
    seedGets();

    await updateMcp("p-1", baseParams({ icon: "icons/fresh-upload.png" }));

    expect(upsertIcon()).toBe("icons/fresh-upload.png");
  });
});

describe("updateMcpReal — full-replace echoes unmodeled connector state", () => {
  // A stored connector whose mcp.json carries fields the form doesn't model
  // (cwd/disabled/timeout), a SECOND server, and a non-modeled attachment.
  function richDetail() {
    return detailPlugin({
      plugin_json: {
        $schema: "cowork-plugin-package-2.0.json",
        connector: { type: "mcp", source: "connector.github-mcp" },
        attachments: [
          {
            path: "mcp.json",
            content_type: "raw",
            raw_content: JSON.stringify({
              mcpServers: {
                "github-mcp": {
                  type: "streamable-http",
                  url: "https://mcp.example.com/github",
                  cwd: "/srv/app",
                  disabled: true,
                  timeout: 60,
                },
                "other-server": { command: "node", args: ["x.js"] },
              },
            }),
          },
          { path: "connector/tools.json", content_type: "raw", raw_content: "[]" },
          { path: "connector/custom.json", content_type: "raw", raw_content: '{"kept":true}' },
        ],
      },
    });
  }

  function writtenUpsert() {
    const call = mock.instance.post.mock.calls.find((c) =>
      (c[0] as string).endsWith("/plugins/upsert")
    ) as [string, { plugin: { plugin_json: { attachments: { path: string; raw_content: string }[] } } }];
    const atts = call[1].plugin.plugin_json.attachments;
    const mcp = atts.find((a) => a.path === "mcp.json")!;
    return {
      servers: (JSON.parse(mcp.raw_content) as { mcpServers: Record<string, Record<string, unknown>> })
        .mcpServers,
      paths: atts.map((a) => a.path),
    };
  }

  it("preserves unmodeled server fields, a second server, and a non-modeled attachment on a metadata edit", async () => {
    mock.instance.get.mockImplementation((url: string) => {
      if (url.includes("/plugin_categories")) return Promise.resolve(categoriesOk());
      if (url.includes("/plugins/detail")) return Promise.resolve({ data: { data: richDetail() } });
      throw new Error(`unexpected GET ${url}`);
    });
    mock.instance.post.mockResolvedValue({ data: { data: detailPlugin() } });

    // A metadata edit (new slogan); everything else the form re-derives.
    await updateMcp("p-1", baseParams({ slogan: "Renamed" }));

    const { servers, paths } = writtenUpsert();
    // Unmodeled keys on the modeled server survive.
    expect(servers["github-mcp"].cwd).toBe("/srv/app");
    expect(servers["github-mcp"].disabled).toBe(true);
    expect(servers["github-mcp"].timeout).toBe(60);
    // Modeled fields still written from the form.
    expect(servers["github-mcp"].url).toBe("https://mcp.example.com/github");
    // The second server is not collapsed.
    expect(servers["other-server"]).toEqual({ command: "node", args: ["x.js"] });
    // The non-modeled attachment survives alongside the rebuilt five.
    expect(paths).toContain("connector/custom.json");
    expect(paths).toContain("mcp.json");
  });

  it("selects the modeled server by manifest slug, not position (multi-server, slug not first)", async () => {
    // mcp.json has the connector's own server (github-mcp = manifest slug) AFTER
    // an unrelated helper. A positional pick would read a-helper's config and
    // overwrite github-mcp with it (dropping a-helper) on a metadata edit.
    const wire = detailPlugin({
      manifest_json: { name: "github-mcp", description: "Issues and PRs" },
      plugin_json: {
        $schema: "cowork-plugin-package-2.0.json",
        connector: { type: "mcp", source: "connector.github-mcp" },
        attachments: [
          {
            path: "mcp.json",
            content_type: "raw",
            raw_content: JSON.stringify({
              mcpServers: {
                "a-helper": { command: "helper", args: ["--serve"] },
                "github-mcp": {
                  type: "streamable-http",
                  url: "https://mcp.example.com/github",
                  cwd: "/srv/gh",
                },
              },
            }),
          },
        ],
      },
    });
    mock.instance.get.mockImplementation((url: string) => {
      if (url.includes("/plugin_categories")) return Promise.resolve(categoriesOk());
      if (url.includes("/plugins/detail")) return Promise.resolve({ data: { data: wire } });
      throw new Error(`unexpected GET ${url}`);
    });
    mock.instance.post.mockResolvedValue({ data: { data: detailPlugin() } });

    await updateMcp("p-1", baseParams({ slogan: "Renamed" }));

    const { servers } = writtenUpsert();
    // github-mcp keeps ITS config (+ unmodeled cwd), NOT a-helper's.
    expect(servers["github-mcp"].url).toBe("https://mcp.example.com/github");
    expect(servers["github-mcp"].cwd).toBe("/srv/gh");
    expect(servers["github-mcp"].command).toBeUndefined();
    // a-helper is preserved verbatim, not dropped.
    expect(servers["a-helper"]).toEqual({ command: "helper", args: ["--serve"] });
  });
});
