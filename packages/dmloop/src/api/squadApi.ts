// @octo/loop — Squad API（真实 HTTP，对齐 multica REST 契约）
import type { Squad, SquadMember, UpsertSquadReq, ListParams } from "./types";
import { httpGet, httpPost, httpPut, httpDelete, currentWorkspaceId } from "./http";

export function listSquads(params?: ListParams): Promise<Squad[]> {
  return httpGet<Squad[]>("/squads", {
    workspace_id: params?.workspace_id ?? currentWorkspaceId(),
    keyword: params?.keyword,
  });
}

export function getSquad(id: string): Promise<Squad> {
  return httpGet<Squad>(`/squads/${id}`);
}

export function createSquad(req: UpsertSquadReq): Promise<Squad> {
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

export function addSquadMember(
  squadId: string,
  memberId: string,
  role = "member",
): Promise<Squad> {
  return httpPost<Squad>(`/squads/${squadId}/members`, { member_id: memberId, role });
}

export function removeSquadMember(squadId: string, memberId: string): Promise<Squad> {
  return httpDelete<Squad>(`/squads/${squadId}/members`, { member_id: memberId });
}

export type { SquadMember };
