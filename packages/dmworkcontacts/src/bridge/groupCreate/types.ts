import type { Channel } from "wukongimjssdk";

export interface GroupCreateChannelInput {
  channelID: string;
  channelType: number;
}

export interface GroupCreateCandidateContact {
  name: string;
  uid: string;
  avatar?: string;
  robot?: boolean | number;
}

export interface GroupCreateContactRecord {
  name: string;
  uid: string;
  avatar?: string;
  robot?: boolean | number;
}

export interface GroupCreateSpaceMember {
  name: string;
  uid: string;
  avatar?: string;
  robot?: boolean | number;
}

export interface GroupCreateSubmitOptions {
  categoryId?: string;
  name?: string;
  avatarText?: string;
  avatarColor?: number;
}

export type GroupCreateSubmitAction = "createGroup" | "addMember";

export interface GroupCreateRuntime {
  addSubscribers(channel: Channel, uids: string[]): Promise<void>;
  createChannel(
    uids: string[],
    options?: GroupCreateSubmitOptions
  ): Promise<{ group_no?: string } | undefined>;
  getAvatarUser(uid: string): string;
  getContactsList(): GroupCreateContactRecord[];
  getCurrentChannelInfo(channel: Channel): any;
  getCurrentChannelSubscribers(channel: Channel): Array<{ uid: string }>;
  getCurrentSpaceId(): string | undefined;
  getLoginUid(): string | undefined;
  getSpaceMembers(
    spaceId: string,
    page: number,
    limit: number
  ): Promise<GroupCreateSpaceMember[]>;
  getSuperGroupSubscribers(channel: Channel): Promise<Array<{ uid: string }>>;
  showConversation(
    channel: Channel,
    options?: { fromSidebarList?: boolean }
  ): void;
  syncCurrentChannelSubscribers(channel: Channel): Promise<any>;
}
