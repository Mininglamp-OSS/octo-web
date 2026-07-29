import { Channel } from "wukongimjssdk";

export interface ChannelWebhookMemberOption {
  uid: string;
  name: string;
  isBot: boolean;
}

export type ChannelWebhookGroupSubscriber = {
  uid?: string;
  name?: string | null;
  remark?: string | null;
  status?: number;
  orgData?: {
    robot?: number;
    real_name?: string | null;
    realname_verified?: boolean | number | string | null;
  } | null;
};

export interface ChannelWebhookMemberRuntime {
  getSubscribers(channel: Channel): ChannelWebhookGroupSubscriber[];
  syncSubscribers(channel: Channel): Promise<void>;
  isBotMember(uid: string, subscriber: ChannelWebhookGroupSubscriber): boolean;
  getSelfUid(): string;
  getSelfDisplayName(): string;
}
