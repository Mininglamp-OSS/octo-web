// @octo/loop — Squad API (Mock)
import type { Squad, SquadMember, UpsertSquadReq, ListParams, AssigneeType } from "./types";
import { resolveWorkspaceId } from "./types";
import { store, nextId, sleep, clone } from "./mockStore";
import { CANDIDATES } from "./mock/seed";

function nameOf(id?: string | null): string {
  if (!id) return "";
  return CANDIDATES.find((c) => c.id === id)?.name ?? id;
}

export async function listSquads(params?: ListParams): Promise<Squad[]> {
  await sleep();
  const ws = resolveWorkspaceId(params?.workspace_id);
  let rows = store.squads.filter((s) => s.workspace_id === ws);
  const kw = params?.keyword?.trim().toLowerCase();
  if (kw) rows = rows.filter((s) => s.name.toLowerCase().includes(kw));
  return clone(rows);
}

export async function getSquad(id: string): Promise<Squad | null> {
  await sleep(120);
  const row = store.squads.find((s) => s.id === id);
  return row ? clone(row) : null;
}

export async function createSquad(req: UpsertSquadReq): Promise<Squad> {
  await sleep();
  const nowIso = new Date().toISOString();
  const leaderId = req.leader_id ?? "u-1";
  const leaderName = nameOf(leaderId);
  const squad: Squad = {
    id: nextId("s"),
    workspace_id: resolveWorkspaceId(),
    name: req.name,
    description: req.description ?? "",
    instructions: req.instructions ?? "",
    leader_id: leaderId,
    leader_name: leaderName,
    creator_name: "lvsijia",
    members: [
      {
        member_type: (CANDIDATES.find((c) => c.id === leaderId)?.type ??
          "member") as AssigneeType,
        member_id: leaderId,
        member_name: leaderName,
        role: "leader",
      },
    ],
    created_at: nowIso,
    updated_at: nowIso,
  };
  store.squads.push(squad);
  return clone(squad);
}

export async function updateSquad(
  id: string,
  req: UpsertSquadReq,
): Promise<Squad> {
  await sleep(120);
  const row = store.squads.find((s) => s.id === id);
  if (!row) throw new Error("squad not found");
  row.name = req.name;
  if (req.description !== undefined) row.description = req.description;
  if (req.instructions !== undefined) row.instructions = req.instructions;
  if (req.leader_id !== undefined) {
    row.leader_id = req.leader_id;
    row.leader_name = nameOf(req.leader_id);
  }
  row.updated_at = new Date().toISOString();
  return clone(row);
}

export async function deleteSquad(id: string): Promise<void> {
  await sleep(100);
  store.squads = store.squads.filter((s) => s.id !== id);
}

export async function addSquadMember(
  squadId: string,
  memberId: string,
  role = "member",
): Promise<Squad> {
  await sleep(100);
  const row = store.squads.find((s) => s.id === squadId);
  if (!row) throw new Error("squad not found");
  const cand = CANDIDATES.find((c) => c.id === memberId);
  if (cand && !row.members.some((m) => m.member_id === memberId)) {
    row.members.push({
      member_type: cand.type,
      member_id: cand.id,
      member_name: cand.name,
      role,
    });
    row.updated_at = new Date().toISOString();
  }
  return clone(row);
}

export async function removeSquadMember(
  squadId: string,
  memberId: string,
): Promise<Squad> {
  await sleep(100);
  const row = store.squads.find((s) => s.id === squadId);
  if (!row) throw new Error("squad not found");
  row.members = row.members.filter((m) => m.member_id !== memberId);
  row.updated_at = new Date().toISOString();
  return clone(row);
}

export type { SquadMember };
