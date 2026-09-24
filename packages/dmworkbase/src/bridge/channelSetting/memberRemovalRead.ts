import { Channel, Subscriber } from "wukongimjssdk";
import { ChannelMemberService } from "../../Service/ChannelMemberService";
import { canRemoveChannelSettingSubscriber } from "../../features/channelSetting/memberRemovalPermission";

export interface MemberEntryCursor {
  nextPage: number;
  signatures: Set<string>;
}

export function newMemberEntryCursor(): MemberEntryCursor {
  return { nextPage: 1, signatures: new Set() };
}

export type MemberEntryResult = "found" | "none" | "partial";

/** One user-visible check has a finite budget; only a short page proves none. */
export async function findRemovableGroupMember(
  channel: Channel,
  viewerUid: string,
  viewerRole: number,
  signal: AbortSignal,
  cursor = newMemberEntryCursor()
): Promise<MemberEntryResult> {
  const limit = 100;
  for (let fetched = 0; fetched < 5 && !signal.aborted; fetched++) {
    const rows = await ChannelMemberService.page(channel, cursor.nextPage, limit, signal);
    if (signal.aborted) return "partial";
    const signature = JSON.stringify(rows.map(row => row.uid));
    if (rows.length && cursor.signatures.has(signature)) {
      throw new Error("Repeated group member page");
    }
    cursor.signatures.add(signature);
    cursor.nextPage++;
    if (rows.some((subscriber) => canRemoveChannelSettingSubscriber({
      viewerUid, viewerRole, subscriber,
    }))) return "found";
    if (rows.length < limit) return "none";
  }
  return "partial";
}

export interface MemberSelectionEvidence {
  absent: string[];
  present: Subscriber[];
  unknown: string[];
}

export interface MemberReadOptions {
  retryUnknown?: boolean;
  isCurrent?: () => boolean;
  onProgress?: (checked: number, total: number) => void;
}

/** Targeted evidence, independent of paged/search results. Bound request fan-out. */
export async function readSelectedMembers(
  channel: Channel,
  uids: string[],
  signal?: AbortSignal,
  options: MemberReadOptions = {}
): Promise<MemberSelectionEvidence> {
  const result: MemberSelectionEvidence = { absent: [], present: [], unknown: [] };
  const queue = [...new Set(uids)];
  let index = 0;
  let checked = 0;
  const current = () => !signal?.aborted && (options.isCurrent?.() ?? true);
  const worker = async () => {
    while (index < queue.length && current()) {
      const uid = queue[index++];
      const attempts = options.retryUnknown ? 2 : 1;
      for (let attempt = 0; attempt < attempts && current(); attempt++) {
        try {
          const row = await ChannelMemberService.lookup(channel, uid, signal);
          if (!current()) return;
          if (row) result.present.push(row);
          else result.absent.push(uid);
          break;
        } catch {
          if (!current()) return;
          if (attempt === attempts - 1) result.unknown.push(uid);
        }
      }
      if (current()) options.onProgress?.(++checked, queue.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  const resolved = new Set([...result.absent, ...result.present.map(row => row.uid), ...result.unknown]);
  for (const uid of queue) if (!resolved.has(uid)) result.unknown.push(uid);
  return result;
}
