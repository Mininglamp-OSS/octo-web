// @octo/loop — Squad API（真实 fleet 联调）
import type { Squad, SquadMember, UpsertSquadReq, ListParams } from "./types";
import { httpGet, httpPost, httpPut, httpDelete, httpPatch } from "./http";
import { ensureDirectory, actorName } from "./directory";

function enrichSquad(s: Squad, dir: Awaited<ReturnType<typeof ensureDirectory>>): Squad {
  const members = (s.members ?? s.member_preview ?? []).map((m) => ({
    ...m,
    member_name: actorName(dir, m.member_type, m.member_id) ?? m.member_id,
  }));
  return {
    ...s,
    members,
    leader_name: actorName(dir, "agent", s.leader_id) ?? actorName(dir, "member", s.leader_id),
    creator_name: actorName(dir, "member", s.creator_id),
  };
}

export async function listSquads(params?: ListParams): Promise<Squad[]> {
  const [rows, dir] = await Promise.all([httpGet<Squad[]>("/squads"), ensureDirectory()]);
  let out = (rows ?? []).map((s) => enrichSquad(s, dir));
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) out = out.filter((s) => s.name.toLowerCase().includes(kw));
  return out;
}

export async function getSquad(id: string): Promise<Squad> {
  const [s, members, dir] = await Promise.all([
    httpGet<Squad>(`/squads/${id}`),
    httpGet<SquadMember[]>(`/squads/${id}/members`).catch(() => [] as SquadMember[]),
    ensureDirectory(),
  ]);
  return enrichSquad({ ...s, members }, dir);
}

export function createSquad(req: UpsertSquadReq): Promise<Squad> {
  // fleet 要求 leader_id；无则由页面校验。
  return httpPost<Squad>("/squads", req);
}

export function updateSquad(id: string, req: UpsertSquadReq): Promise<Squad> {
  return httpPut<Squad>(`/squads/${id}`, req);
}

export function deleteSquad(id: string): Promise<void> {
  return httpDelete<void>(`/squads/${id}`);
}

export function listSquadMembers(id: string): Promise<SquadMember[]> {
  return httpGet<SquadMember[]>(`/squads/${id}/members`);
}

export async function addSquadMember(
  squadId: string,
  memberType: SquadMember["member_type"],
  memberId: string,
  role = "",
): Promise<Squad> {
  await httpPost(`/squads/${squadId}/members`, { member_type: memberType, member_id: memberId, role });
  return getSquad(squadId);
}

export async function removeSquadMember(
  squadId: string,
  memberType: SquadMember["member_type"],
  memberId: string,
): Promise<Squad> {
  await httpDelete(`/squads/${squadId}/members`, { member_type: memberType, member_id: memberId });
  return getSquad(squadId);
}

export function updateSquadMemberRole(
  squadId: string,
  memberType: SquadMember["member_type"],
  memberId: string,
  role: string,
): Promise<SquadMember> {
  return httpPatch<SquadMember>(`/squads/${squadId}/members/role`, {
    member_type: memberType,
    member_id: memberId,
    role,
  });
}

export type { SquadMember };
