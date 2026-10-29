// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), logout: vi.fn(),
  responseOnRejected: undefined as ((error: unknown) => Promise<unknown>) | undefined,
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn((_success: unknown, reject: (error: unknown) => Promise<unknown>) => { mock.responseOnRejected = reject; }) } },
}));
vi.mock("axios", () => ({ default: { create: () => mock, isCancel: () => false } }));
vi.mock("@octo/base", () => ({ WKApp: { apiClient: { config: {} }, loginInfo: { token: "tok" }, shared: { currentSpaceId: "sp", logout: mock.logout } }, t: (k: string) => k, buildAcceptLanguage: () => "en-US", DEFAULT_REQUEST_TIMEOUT_MS: 20000 }));
import { getExpert, getSquad, getExpertSkillContent, getSquadSkillContent, getExpertSkillDownloadUrl, getSquadSkillDownloadUrl, fetchSkillPackage, MAX_SKILL_PACKAGE_FETCH_BYTES } from "./expertService";
const relation = (id: string, version: string, kind = "expert_skill") => ({ target_plugin_id: id, target_version_id: version, relation_type: kind, data: { member_key: "member" } });
const pkg = (path: string, text: string) => ({ attachments: [{ path, content_type: "raw", raw_content: text }] });
const snapshot = (id: string, relations: unknown[], path: string, text: string) => ({ version: { plugin_id: id, version_id: "old", relations }, manifest_json: { plugin_name: `old-${id}` }, plugin_json: pkg(path, text) });
function setup() {
  mock.get.mockImplementation((url: string, cfg?: { params?: { plugin_id?: string } }) => {
    let value: unknown;
    if (url.endsWith("/plugin_categories")) value = [];
    else if (url.endsWith("/plugins/detail")) {
      if (cfg?.params?.plugin_id === "expert") value = { plugin: { plugin_id: "expert", plugin_type: "expert", plugin_name: "Expert", manifest_json: {} }, relations: [relation("skill", "s1")] };
      else if (cfg?.params?.plugin_id === "team") value = { plugin: { plugin_id: "team", plugin_type: "expert_team", plugin_name: "Team", manifest_json: {} }, relations: [relation("member", "e1", "expert_team_expert")] };
      else throw new Error("current dependency must never be read");
    } else if (url.endsWith("/member/versions/e1")) value = snapshot("member", [relation("skill", "s1")], "AGENTS.md", "Expert V1");
    else if (url.endsWith("/skill/versions/s1")) value = snapshot("skill", [], "SKILL.md", "Skill V1");
    else if (url.endsWith("/skill/versions/s1/file")) return Promise.resolve({ data: "Skill V1" });
    else throw new Error(`unexpected ${url}`);
    return Promise.resolve({ data: { data: value } });
  });
}
beforeEach(() => { mock.get.mockReset(); mock.logout.mockReset(); setup(); });
describe("exact pinned content", () => {
  it("reads Skill snapshot and original markdown without current metadata/content", async () => {
    const expert = await getExpert("expert");
    expect(expert.skills?.[0]).toMatchObject({ name: "old-skill", versionId: "s1", hasContent: true });
    expect(await getExpertSkillContent("expert", 0)).toBe("Skill V1");
    expect(await getExpertSkillDownloadUrl("expert", 0)).toBe("/market/api/v1/plugins/skill/versions/s1");
    expect(mock.get.mock.calls.some(([url]) => url.endsWith("/plugins/skill_md"))).toBe(false);
  });
  it("recursively follows pinned member relations and Skill files", async () => {
    const team = await getSquad("team");
    expect(team.members[0]).toMatchObject({ instruction: "Expert V1", name: "old-member" });
    expect(await getSquadSkillContent("team", "member", 0)).toBe("Skill V1");
  });
  it.each([404, 403, 500])("surfaces failed pinned Skill reads (%s), without dropping or latest fallback", async status => {
    const original = mock.get.getMockImplementation()!;
    mock.get.mockImplementation((url, ...rest) => url.endsWith("/skill/versions/s1") ? Promise.reject({ response: { status } }) : original(url, ...rest));
    await expect(getExpert("expert")).rejects.toThrow();
  });
  it("does not drop a missing pinned member", async () => {
    const original = mock.get.getMockImplementation()!;
    mock.get.mockImplementation((url, ...rest) => url.endsWith("/member/versions/e1") ? Promise.reject({ response: { status: 404 } }) : original(url, ...rest));
    await expect(getSquad("team")).rejects.toThrow();
  });
  it("creates a tree package exclusively from the historical file endpoints", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/versions/s1")) {
        const data = snapshot("skill", [], "SKILL.md", "Skill V1");
        data.plugin_json.attachments.push({ path: "references/checklist.md", content_type: "raw", raw_content: "Checklist V1" });
        return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
      }
      return { ok: true, headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(url.includes("references") ? "Checklist V1" : "Skill V1").buffer };
    }));
    try {
      const bytes = await fetchSkillPackage("/market/api/v1/plugins/skill/versions/s1");
      const JSZip = (await import("jszip")).default;
      expect(await (await JSZip.loadAsync(bytes)).file("SKILL.md")!.async("string")).toBe("Skill V1");
      expect(await (await JSZip.loadAsync(bytes)).file("references/checklist.md")!.async("string")).toBe("Checklist V1");
      expect(calls).toEqual(["/market/api/v1/plugins/skill/versions/s1", "/market/api/v1/plugins/skill/versions/s1/file?path=SKILL.md", "/market/api/v1/plugins/skill/versions/s1/file?path=references%2Fchecklist.md"]);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("concurrent detail snapshots", () => {
  it.each(["expert", "team"])("rejects an older %s response after a newer fan-out completes", async kind => {
    let finishOld!: (value: unknown) => void;
    const oldSkill = new Promise(resolve => { finishOld = resolve; });
    let reads = 0;
    mock.get.mockImplementation((url: string) => {
      const response = (data: unknown) => Promise.resolve({ data: { data } });
      if (url.endsWith("/plugin_categories")) return response([]);
      if (url.endsWith("/plugins/detail")) {
        const version = ++reads;
        return response({ plugin: { plugin_id: kind, plugin_type: kind === "expert" ? "expert" : "expert_team", manifest_json: {} }, relations: [kind === "expert" ? relation("skill", `s${version}`) : relation("member", `e${version}`, "expert_team_expert")] });
      }
      if (url.endsWith("/member/versions/e1")) return response(snapshot("member", [relation("skill", "s1")], "AGENTS.md", "old member"));
      if (url.endsWith("/member/versions/e2")) return response(snapshot("member", [relation("skill", "s2")], "AGENTS.md", "new member"));
      if (url.endsWith("/skill/versions/s1")) return oldSkill;
      if (url.endsWith("/skill/versions/s2")) return response(snapshot("skill", [], "SKILL.md", "new body"));
      if (url.endsWith("/skill/versions/s2/file")) return Promise.resolve({ data: "new body" });
      throw new Error(`unexpected ${url}`);
    });
    const load = kind === "expert" ? getExpert : getSquad;
    const older = load(kind);
    const rejected = expect(older).rejects.toMatchObject({ __CANCEL__: true });
    await vi.waitFor(() => expect(mock.get.mock.calls.some(([url]) => url.endsWith("/skill/versions/s1"))).toBe(true));
    await load(kind);
    finishOld({ data: { data: snapshot("skill", [], "SKILL.md", "old body") } });
    await rejected;
    const body = kind === "expert" ? await getExpertSkillContent(kind, 0) : await getSquadSkillContent(kind, "member", 0);
    expect(body).toBe("new body");
    const path = kind === "expert" ? await getExpertSkillDownloadUrl(kind, 0) : await getSquadSkillDownloadUrl(kind, "member", 0);
    expect(path).toContain("/skill/versions/s2");
  });

  it.each(["expert", "team"])("keeps a displayed %s pin after another view refreshes its positional index", async kind => {
    const displayed = { name: "Old displayed skill", pluginId: "skill", versionId: "s1" };
    const original = mock.get.getMockImplementation()!;
    mock.get.mockImplementation((url, ...rest) => {
      if (url.endsWith("/skill/versions/s2")) return Promise.resolve({ data: { data: snapshot("skill", [], "SKILL.md", "new body") } });
      if (url.endsWith("/plugins/detail") && kind === "expert") return Promise.resolve({ data: { data: { plugin: { plugin_id: "expert", plugin_type: "expert", manifest_json: {} }, relations: [relation("skill", "s2")] } } });
      if (url.endsWith("/member/versions/e1") && kind === "team") return Promise.resolve({ data: { data: snapshot("member", [relation("skill", "s2")], "AGENTS.md", "new member") } });
      return original(url, ...rest);
    });
    if (kind === "expert") {
      await getExpert(kind);
      expect(await getExpertSkillContent(kind, 0, displayed)).toBe("Skill V1");
      expect(await getExpertSkillDownloadUrl(kind, 0, displayed)).toContain("/versions/s1");
    } else {
      await getSquad(kind);
      expect(await getSquadSkillContent(kind, "member", 0, displayed)).toBe("Skill V1");
      expect(await getSquadSkillDownloadUrl(kind, "member", 0, displayed)).toContain("/versions/s1");
    }
  });
});

it("uses the pinned description and release label, and only matching graph provenance", async () => {
  const original = mock.get.getMockImplementation()!;
  mock.get.mockImplementation((url, ...rest) => {
    if (url.endsWith("/plugins/detail_graph")) return Promise.resolve({ data: { data: { related_plugins: [
      { plugin_id: "skill", current_version_id: "latest", creator_name: "Wrong author", current_version: "9.0.0", manifest_json: { description: "Wrong summary" } },
      { plugin_id: "skill", current_version_id: "s1", creator_name: "Skill creator", created_by_type: "bot", created_by_bot_name: "Author bot" },
    ] } } });
    if (url.endsWith("/skill/versions/s1")) return Promise.resolve({ data: { data: {
      ...snapshot("skill", [], "SKILL.md", "Pinned body"),
      version: { plugin_id: "skill", version_id: "s1", declared_version: "1.0.0", release: { version_label: "1.0.1" }, relations: [] },
      manifest_json: { plugin_name: "Pinned skill", description: "Pinned description" },
    } } });
    return original(url, ...rest);
  });
  const expert = await getExpert("expert");
  expect(expert.skills?.[0]).toMatchObject({ name: "Pinned skill", summary: "Pinned description", version: "1.0.1", creatorName: "Skill creator", botName: "Author bot" });
});

it("does not borrow a creator from the current head when the pinned graph node is absent", async () => {
  const original = mock.get.getMockImplementation()!;
  mock.get.mockImplementation((url, ...rest) => url.endsWith("/plugins/detail_graph") ? Promise.resolve({ data: { data: { related_plugins: [
    { plugin_id: "skill", current_version_id: "latest", creator_name: "Wrong author" },
  ] } } }) : original(url, ...rest));
  expect((await getExpert("expert")).skills?.[0]?.creatorName).toBeUndefined();
});

it("loads connector metadata and configuration for both experts and pinned team members", async () => {
  const original = mock.get.getMockImplementation()!;
  mock.get.mockImplementation(async (url, cfg, ...rest) => {
    if (url.endsWith("/plugins/detail") && cfg?.params?.plugin_id === "connector") return { data: { data: { plugin: {
      plugin_id: "connector", plugin_type: "connector", plugin_name: "Data MCP", creator_name: "MCP creator", manifest_json: { description: "Query metrics" }, plugin_json: pkg("mcp.json", '{"mcpServers":{}}'),
    } } } };
    const result = await original(url, cfg, ...rest);
    if ((url.endsWith("/plugins/detail") && cfg?.params?.plugin_id === "expert") || url.endsWith("/member/versions/e1")) {
      const detail = result.data.data;
      const relations = detail.version?.relations || detail.relations;
      relations.push({ target_plugin_id: "connector", relation_type: "expert_connector" });
    }
    return result;
  });
  expect((await getExpert("expert")).connectors?.[0]).toMatchObject({ name: "Data MCP", summary: "Query metrics", creatorName: "MCP creator" });
  expect((await getSquad("team")).members[0].connectors?.[0].name).toBe("Data MCP");
});

it("surfaces a connector read failure instead of showing a partial dependency list", async () => {
  const original = mock.get.getMockImplementation()!;
  mock.get.mockImplementation(async (url, cfg, ...rest) => {
    if (url.endsWith("/plugins/detail") && cfg?.params?.plugin_id === "connector") throw { response: { status: 500 } };
    const result = await original(url, cfg, ...rest);
    if (url.endsWith("/plugins/detail") && cfg?.params?.plugin_id === "expert") result.data.data.relations.push({ target_plugin_id: "connector", relation_type: "expert_connector" });
    return result;
  });
  await expect(getExpert("expert")).rejects.toThrow();
});


it.each(["expert", "team"])("keeps the session when optional graph attribution returns 401 for %s", async root => {
  const original = mock.get.getMockImplementation()!;
  mock.get.mockImplementation((url, ...rest) => {
    if (url.endsWith("/plugins/detail_graph")) {
      // Drive the real interceptor too: rejecting the mock request alone would
      // bypass the logout side effect that this regression is protecting.
      return mock.responseOnRejected!({ config: { url }, response: { status: 401 } });
    }
    return original(url, ...rest);
  });
  const detail = root === "team" ? await getSquad(root) : await getExpert(root);
  expect(detail.id).toBe(root);
  const skill = detail.kind === "squad" ? detail.members[0].skills?.[0] : detail.skills?.[0];
  expect(skill).toMatchObject({ versionId: "s1", name: "old-skill" });
  expect(skill?.creatorName).toBeUndefined();
  expect(mock.logout).not.toHaveBeenCalled();
});

it("still logs out for required detail reads and unrelated graph-like paths", async () => {
  for (const url of ["/market/api/v1/plugins/detail", "/market/api/v1/other/plugins/detail_graph"]) {
    await expect(mock.responseOnRejected!({ config: { url }, response: { status: 401 } })).rejects.toBeTruthy();
  }
  expect(mock.logout).toHaveBeenCalledTimes(2);
});

it("resolves nested member skill creators from the root's transitive pinned graph", async () => {
  const original = mock.get.getMockImplementation()!;
  mock.get.mockImplementation((url, ...rest) => {
    if (url.endsWith("/plugins/detail_graph")) return Promise.resolve({ data: { data: { related_plugins: [
      { plugin_id: "member", current_version_id: "e1", creator_name: "Expert creator" },
      { plugin_id: "skill", current_version_id: "latest", creator_name: "Wrong current creator" },
      { plugin_id: "skill", current_version_id: "s1", creator_name: "Pinned skill creator", created_by_type: "bot", created_by_bot_name: "Skill bot" },
    ] } } });
    return original(url, ...rest);
  });
  const team = await getSquad("team");
  expect(team.members[0].skills?.[0]).toMatchObject({ versionId: "s1", creatorName: "Pinned skill creator", botName: "Skill bot" });
  const graphCalls = mock.get.mock.calls.filter(([url]) => url.endsWith("/plugins/detail_graph"));
  expect(graphCalls).toHaveLength(1);
  expect(graphCalls[0][1].params.plugin_id).toBe("team");
});


it("rejects an oversized historical JSON Content-Length before reading or parsing", async () => {
  const json = vi.fn();
  const arrayBuffer = vi.fn();
  const getReader = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true,
    headers: new Headers({ "content-length": String(MAX_SKILL_PACKAGE_FETCH_BYTES + 1) }),
    body: { getReader }, json, arrayBuffer,
  }));
  try {
    await expect(fetchSkillPackage("/market/api/v1/plugins/skill/versions/s1")).rejects.toThrow("package too large");
    expect(getReader).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it.each([undefined, "1"])("caps historical JSON streams with missing or misleading Content-Length (%s)", async length => {
  const read = vi.fn()
    .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_SKILL_PACKAGE_FETCH_BYTES) })
    .mockResolvedValueOnce({ done: false, value: new Uint8Array(1) })
    .mockResolvedValueOnce({ done: true });
  const cancel = vi.fn().mockResolvedValue(undefined);
  const json = vi.fn();
  const headers = new Headers();
  if (length) headers.set("content-length", length);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers,
    body: { getReader: () => ({ read, cancel }) }, json,
  }));
  try {
    await expect(fetchSkillPackage("/market/api/v1/plugins/skill/versions/s1")).rejects.toThrow("package too large");
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it.each(["skill", "expert", "expert_team"])("rejects an expert_connector target of type %s even with mcp.json", async pluginType => {
  const original = mock.get.getMockImplementation()!;
  mock.get.mockImplementation(async (url, cfg, ...rest) => {
    if (url.endsWith("/plugins/detail") && cfg?.params?.plugin_id === "wrong-kind") {
      return { data: { data: { plugin: { plugin_id: "wrong-kind", plugin_name: "Not a connector", plugin_type: pluginType,
        manifest_json: {}, plugin_json: pkg("mcp.json", '{"mcpServers":{}}'),
      } } } };
    }
    const response = await original(url, cfg, ...rest);
    if (url.endsWith("/plugins/detail") && cfg?.params?.plugin_id === "expert") {
      response.data.data.relations.push({ relation_type: "expert_connector", target_plugin_id: "wrong-kind" });
    }
    return response;
  });
  await expect(getExpert("expert")).rejects.toThrow("Unexpected connector relation target type");
});
