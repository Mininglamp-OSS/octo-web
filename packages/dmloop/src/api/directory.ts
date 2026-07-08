// @octo/loop — Directory：解析展示用名字 + 提供 assignee 候选。
// fleet 列表接口不返回 assignee_name/project_name 等，这里统一加载并缓存后回填。
import type { AssigneeCandidate, AssigneeType } from "./types";
import { httpGet, currentWorkspaceId, currentWorkspaceSlug } from "./http";

interface Directory {
  slug: string;
  memberName: Map<string, string>;
  agentName: Map<string, string>;
  squadName: Map<string, string>;
  projectName: Map<string, string>;
  candidates: AssigneeCandidate[];
}

let _cache: Directory | null = null;
let _loading: Promise<Directory> | null = null;

async function build(): Promise<Directory> {
  const slug = currentWorkspaceSlug();
  const wsId = currentWorkspaceId();
  const [members, agents, squads, projectsResp] = await Promise.all([
    wsId ? httpGet<Array<{ user_id: string; name: string }>>(`/workspaces/${wsId}/members`).catch(() => []) : Promise.resolve([]),
    httpGet<Array<{ id: string; name: string }>>("/agents").catch(() => []),
    httpGet<Array<{ id: string; name: string }>>("/squads").catch(() => []),
    httpGet<{ projects: Array<{ id: string; title: string }> }>("/projects").catch(() => ({ projects: [] })),
  ]);
  const memberName = new Map<string, string>();
  const candidates: AssigneeCandidate[] = [];
  for (const m of members) {
    memberName.set(m.user_id, m.name);
    candidates.push({ id: m.user_id, type: "member", name: m.name });
  }
  const agentName = new Map<string, string>();
  for (const a of agents) {
    agentName.set(a.id, a.name);
    candidates.push({ id: a.id, type: "agent", name: a.name });
  }
  const squadName = new Map<string, string>();
  for (const s of squads) {
    squadName.set(s.id, s.name);
    candidates.push({ id: s.id, type: "squad", name: s.name });
  }
  const projectName = new Map<string, string>();
  for (const p of (projectsResp.projects ?? [])) projectName.set(p.id, p.title);
  return { slug, memberName, agentName, squadName, projectName, candidates };
}

export async function ensureDirectory(force = false): Promise<Directory> {
  if (!force && _cache && _cache.slug === currentWorkspaceSlug()) return _cache;
  if (_loading && _cache?.slug === currentWorkspaceSlug()) return _loading;
  _loading = build().then((d) => {
    _cache = d;
    _loading = null;
    return d;
  });
  return _loading;
}

export function invalidateDirectory(): void {
  _cache = null;
  _loading = null;
}

export function actorName(
  dir: Directory,
  type: AssigneeType | null | undefined,
  id: string | null | undefined,
): string | null {
  if (!type || !id) return null;
  if (type === "member") return dir.memberName.get(id) ?? null;
  if (type === "agent") return dir.agentName.get(id) ?? null;
  if (type === "squad") return dir.squadName.get(id) ?? null;
  return null;
}

export async function listAssigneeCandidates(): Promise<AssigneeCandidate[]> {
  const dir = await ensureDirectory();
  return dir.candidates;
}
