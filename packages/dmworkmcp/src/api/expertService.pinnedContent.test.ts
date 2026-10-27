import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }));
vi.mock("axios", () => ({ default: { create: () => mock, isCancel: () => false } }));
vi.mock("@octo/base", () => ({ WKApp: { apiClient: { config: {} }, loginInfo: { token: "tok" }, shared: { currentSpaceId: "sp" } }, t: (k: string) => k, buildAcceptLanguage: () => "en-US", DEFAULT_REQUEST_TIMEOUT_MS: 20000 }));
import { getExpert, getSquad, getExpertSkillContent, getSquadSkillContent, getExpertSkillDownloadUrl, fetchSkillPackage } from "./expertService";
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
beforeEach(() => { mock.get.mockReset(); setup(); });
describe("exact pinned content", () => {
  it("reads Skill snapshot and original markdown without current metadata/content", async () => {
    const expert = await getExpert("expert");
    expect(expert.skills[0]).toMatchObject({ name: "old-skill", versionId: "s1", hasContent: true });
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
      if (url.endsWith("/versions/s1")) return { ok: true, json: async () => ({ data: snapshot("skill", [], "SKILL.md", "Skill V1") }) };
      return { ok: true, headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode("Skill V1").buffer };
    }));
    try {
      const bytes = await fetchSkillPackage("/market/api/v1/plugins/skill/versions/s1");
      const JSZip = (await import("jszip")).default;
      expect(await (await JSZip.loadAsync(bytes)).file("SKILL.md")!.async("string")).toBe("Skill V1");
      expect(calls).toEqual(["/market/api/v1/plugins/skill/versions/s1", "/market/api/v1/plugins/skill/versions/s1/file?path=SKILL.md"]);
    } finally { vi.unstubAllGlobals(); }
  });
});
