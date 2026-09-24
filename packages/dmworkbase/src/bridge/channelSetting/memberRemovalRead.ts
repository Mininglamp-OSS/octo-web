import { Channel, Subscriber } from "wukongimjssdk";
import { ChannelMemberService } from "../../Service/ChannelMemberService";
import { canRemoveChannelSettingSubscriber } from "../../features/channelSetting/memberRemovalPermission";

/** A cache miss is unknown. Only the end of the server scan establishes absence. */
export async function findRemovableGroupMember(
  channel: Channel,
  viewerUid: string,
  viewerRole: number,
  signal: AbortSignal
): Promise<boolean> {
  const limit = 100;
  for (let page = 1; !signal.aborted; page++) {
    const rows = await ChannelMemberService.page(channel, page, limit, signal);
    if (signal.aborted) return false;
    if (rows.some((subscriber) => canRemoveChannelSettingSubscriber({
      viewerUid, viewerRole, subscriber,
    }))) return true;
    if (rows.length < limit) return false;
  }
  return false;
}

export interface MemberSelectionEvidence {
  absent: string[];
  present: Subscriber[];
  unknown: string[];
}

/** Targeted evidence, independent of paged/search results. Bound request fan-out. */
export async function readSelectedMembers(
  channel: Channel,
  uids: string[],
  signal?: AbortSignal
): Promise<MemberSelectionEvidence> {
  const result: MemberSelectionEvidence = { absent: [], present: [], unknown: [] };
  const queue = [...new Set(uids)];
  let index = 0;
  const worker = async () => {
    while (index < queue.length && !signal?.aborted) {
      const uid = queue[index++];
      try {
        const row = await ChannelMemberService.lookup(channel, uid, signal);
        if (signal?.aborted) return;
        if (row) result.present.push(row);
        else result.absent.push(uid);
      } catch {
        result.unknown.push(uid);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return result;
}
