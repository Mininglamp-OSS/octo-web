import WKApp from "@octo/base/src/App";
import { isBot } from "@octo/base/src/Components/WKAvatar";
import { SpaceService } from "@octo/base/src/Service/SpaceService";
import { Channel, ChannelTypeGroup, WKSDK } from "wukongimjssdk";
import type { SummaryWorkbenchChannelScope } from "../../bridge/summaryWorkbench/protocol";
import type { WorkbenchMemberCandidate } from "./scope";

const PARTICIPANT_MEMBER_LOAD_CONCURRENCY = 4;

interface RawMember {
  uid?: string;
  user_id?: string;
  id?: string;
  name?: string;
  username?: string;
  avatar?: string;
  robot?: number | boolean;
  is_bot?: boolean;
  is_deleted?: number | boolean;
  status?: number;
  role?: number;
}

export interface ParticipantCandidateLoadResult {
  members: WorkbenchMemberCandidate[];
  roles: Map<string, number>;
}

export interface ParticipantCandidateLoader {
  loadGroupMembers(channel: SummaryWorkbenchChannelScope): Promise<RawMember[]>;
  loadSpaceMembers(spaceId: string): Promise<RawMember[]>;
}

const defaultLoader: ParticipantCandidateLoader = {
  async loadGroupMembers(channel) {
    const sdk = WKSDK.shared();
    const sdkChannel = new Channel(channel.chatId, ChannelTypeGroup);
    await sdk.channelManager.syncSubscribes(sdkChannel);
    return sdk.channelManager.getSubscribes(sdkChannel) || [];
  },
  async loadSpaceMembers(spaceId) {
    if (spaceId) {
      return SpaceService.shared.getRoster(spaceId);
    }
    return ((WKApp.dataSource as unknown as { contactsList?: RawMember[] })
      ?.contactsList ?? []);
  },
};

function memberUID(member: RawMember): string {
  return member.uid || member.user_id || member.id || "";
}

function memberName(member: RawMember, uid: string): string {
  return member.name || member.username || uid;
}

function isHumanMember(member: RawMember, uid: string): boolean {
  return Boolean(uid) && !member.is_bot && member.robot !== 1 && member.robot !== true && !isBot(uid);
}

function isActiveGroupMember(member: RawMember): boolean {
  return (
    member.is_deleted !== 1 &&
    member.is_deleted !== true &&
    (member.status === undefined || member.status === 1)
  );
}

function isActiveSpaceMember(member: RawMember): boolean {
  return member.status !== 2;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export async function loadParticipantCandidates(
  channels: SummaryWorkbenchChannelScope[],
  options: {
    currentUserId: string;
    spaceId: string;
    loader?: ParticipantCandidateLoader;
  }
): Promise<ParticipantCandidateLoadResult> {
  const loader = options.loader ?? defaultLoader;
  const membersByUID = new Map<string, WorkbenchMemberCandidate>();
  const roles = new Map<string, number>();

  const addMember = (member: RawMember, source: "group" | "space") => {
    const uid = memberUID(member);
    const active =
      source === "group"
        ? isActiveGroupMember(member)
        : isActiveSpaceMember(member);
    if (!active || uid === options.currentUserId || !isHumanMember(member, uid)) {
      return;
    }
    if (!membersByUID.has(uid)) {
      membersByUID.set(uid, {
        uid,
        name: memberName(member, uid),
        ...(member.avatar ? { avatar: member.avatar } : {}),
      });
    }
    if (source === "group" && member.role != null) {
      roles.set(uid, Math.max(roles.get(uid) ?? 0, member.role));
    }
  };

  if (channels.length === 0) {
    const members = await loader.loadSpaceMembers(options.spaceId);
    members.forEach((member) => addMember(member, "space"));
  } else {
    const memberLists = await mapWithConcurrency(
      channels,
      PARTICIPANT_MEMBER_LOAD_CONCURRENCY,
      (channel) => loader.loadGroupMembers(channel)
    );
    memberLists.flat().forEach((member) => addMember(member, "group"));
  }

  return { members: [...membersByUID.values()], roles };
}
