// @octo/loop — Directory：解析展示用名字 + 提供 assignee 候选。
// 后端列表接口不返回 assignee_name/project_name 等，这里统一加载并缓存后回填。
// member 身份按 octo_uid 解析成 octo IM 名字（octo web 面统一以 octo 身份展示，
// 而非 后端侧原生显示名）；无 octo_uid 的原生成员回退其后端显示名。
import type { AssigneeCandidate, AssigneeType } from "./types";
import { httpGet, currentWorkspaceId, currentWorkspaceSlug } from "./http";
import { WKApp, SpaceService } from "@octo/base";

interface Directory {
  slug: string;
  memberName: Map<string, string>;
  // member user_id → octo_uid (only for octo-bridged members), for avatar resolution.
  memberOctoUid: Map<string, string>;
  agentName: Map<string, string>;
  squadName: Map<string, string>;
  projectName: Map<string, string>;
  candidates: AssigneeCandidate[];
}

let _cache: Directory | null = null;
let _loading: Promise<Directory> | null = null;
// generation:每次 invalidate 自增。in-flight build 只在自己启动时的 gen 未被 invalidate
// 打断时才提交到 _cache —— 否则(mutation/切 workspace 在 build 途中发生)build 会把
// **失效前的陈旧数据**写回 _cache,重新污染。等待者仍拿到本次 d(自身发起早于 mutation),
// 但不毒害后续读。
let _gen = 0;

async function build(): Promise<Directory> {
  const slug = currentWorkspaceSlug();
  const wsId = currentWorkspaceId();
  const [members, agents, squads, projectsResp] = await Promise.all([
    wsId ? httpGet<Array<{ user_id: string; name: string; octo_uid?: string | null }>>(`/workspaces/${wsId}/members`).catch(() => []) : Promise.resolve([]),
    // include_archived: resolve names for archived (soft-deleted) agents too, so issues/comments/
    // timeline referencing a deleted AI teammate show its name, not a raw id. Archived entries feed
    // the name map only; the assignee picker (candidates) stays active-only.
    httpGet<Array<{ id: string; name: string; archived_at?: string | null }>>("/agents", { include_archived: true }).catch(() => []),
    httpGet<Array<{ id: string; name: string }>>("/squads").catch(() => []),
    httpGet<{ projects: Array<{ id: string; title: string }> }>("/projects").catch(() => ({ projects: [] })),
  ]);
  // Resolve member identity to octo names — but only pull the (potentially large)
  // space roster when at least one member is octo-bridged; a pure-native
  // workspace skips the roster fetch entirely.
  const octoName = new Map<string, string>();
  if (members.some((m) => m.octo_uid)) {
    const roster = await SpaceService.shared.getAllMembers(WKApp.shared.currentSpaceId).catch(() => []);
    for (const s of roster) octoName.set(s.uid, s.name);
  }
  const memberName = new Map<string, string>();
  const memberOctoUid = new Map<string, string>();
  const candidates: AssigneeCandidate[] = [];
  for (const m of members) {
    // octo 身份优先：octo_uid 命中 space 名册取 octo 名字，否则回退后端显示名。
    const name = (m.octo_uid && octoName.get(m.octo_uid)) || m.name;
    memberName.set(m.user_id, name);
    if (m.octo_uid) memberOctoUid.set(m.user_id, m.octo_uid);
    candidates.push({ id: m.user_id, type: "member", name, octo_uid: m.octo_uid ?? null });
  }
  const agentName = new Map<string, string>();
  for (const a of agents) {
    agentName.set(a.id, a.name); // resolve names incl. archived (for display)
    if (!a.archived_at) candidates.push({ id: a.id, type: "agent", name: a.name }); // picker: active only
  }
  const squadName = new Map<string, string>();
  for (const s of squads) {
    squadName.set(s.id, s.name);
    candidates.push({ id: s.id, type: "squad", name: s.name });
  }
  const projectName = new Map<string, string>();
  for (const p of (projectsResp.projects ?? [])) projectName.set(p.id, p.title);
  return { slug, memberName, memberOctoUid, agentName, squadName, projectName, candidates };
}

export async function ensureDirectory(force = false): Promise<Directory> {
  if (!force && _cache && _cache.slug === currentWorkspaceSlug()) return _cache;
  // 已有 in-flight build 时并发调用者直接搭车(切 workspace 会 invalidateDirectory 清空 _loading),
  // 避免冷启动(_cache 尚为 null)多个消费者各拉一遍 directory。
  if (!force && _loading) return _loading;
  const myGen = _gen;
  _loading = build().then((d) => {
    // 只有本次 build 未被 invalidate 打断才提交并清 _loading;被打断则不写 _cache
    // (下次 ensureDirectory 见 _cache/_loading 均已被 invalidate 清空 → 重新 build)。
    if (myGen === _gen) {
      _cache = d;
      _loading = null;
    }
    return d;
  });
  return _loading;
}

export function invalidateDirectory(): void {
  _cache = null;
  _loading = null;
  _gen++;
}

// 目录相关实体(member/agent/squad/project)的写操作**成功后**链在 .then 上:清缓存,
// 下次读(打开新建弹窗、渲染筛选/看板 enrich)即重建 → 增删改后候选/名字/项目选项不再陈旧。
// 放在共享 API 层而非各 UI 处,一处收口护全部消费者(Rule 9)。
export function afterDirectoryMutation<T>(result: T): T {
  invalidateDirectory();
  return result;
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

// actorAvatar returns the octo avatar URL for a MEMBER actor (resolved by
// octo_uid), or undefined for agents/squads and non-octo members — callers keep
// their type icon / initial fallback in those cases.
export function actorAvatar(
  dir: Directory,
  type: AssigneeType | null | undefined,
  id: string | null | undefined,
): string | undefined {
  if (type !== "member" || !id) return undefined;
  const uid = dir.memberOctoUid.get(id);
  return uid ? WKApp.shared.avatarUser(uid) : undefined;
}

// 项目名解析（后端列表不返回 project_name）——与 actorName 对称，复用已缓存 directory。
export function projectNameOf(
  dir: Directory,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return dir.projectName.get(id) ?? null;
}

export async function listAssigneeCandidates(): Promise<AssigneeCandidate[]> {
  const dir = await ensureDirectory();
  return dir.candidates;
}

// 项目筛选下拉的选项，复用已缓存的 directory（不额外请求 /projects），与
// listAssigneeCandidates 对称——调用方无需伸手进 Directory 内部结构。
export async function listProjectOptions(): Promise<Array<{ id: string; title: string }>> {
  const dir = await ensureDirectory();
  return [...dir.projectName].map(([id, title]) => ({ id, title }));
}
