/**
 * mock-im-runtime — Seed 数据类型。
 *
 * test 里喂给 installMockImRuntime 的完整数据契约。以业务 API 的 shape 命名,
 * 而不是 SDK 内部字段,方便未来在不同 case 里复用。
 */

export interface MockUserSeed {
  uid: string;
  name: string;
  logo?: string;
  robot?: 0 | 1;
  category?: string;
  remark?: string;
  realname_verified?: 0 | 1;
  real_name?: string;
  short_no?: string;
  online?: 0 | 1;
  last_offline?: number;
  extra?: Record<string, unknown>;
}

export interface MockGroupSeed {
  group_no: string;
  name: string;
  mute?: 0 | 1;
  top?: 0 | 1;
  logo?: string;
  remark?: string;
  forbidden?: 0 | 1;
  invite?: 0 | 1;
  extra?: Record<string, unknown>;
}

export interface MockConversationSeed {
  channelId: string;
  channelType: number;
  unread?: number;
  timestamp?: number;
  stick?: 0 | 1;
  categoryId?: string | null;
  categorySort?: number;
  spaceId?: string;
}

export interface MockMessageSeed {
  channelId: string;
  channelType: number;
  messageSeq: number;
  fromUid: string;
  timestamp?: number;
  content: { type: number; text?: string; [k: string]: unknown };
}

export interface MockSubscriberSeed {
  uid: string;
  name?: string;
  channelId: string;
  channelType: number;
  role?: number;
  robot?: 0 | 1;
  orgData?: Record<string, unknown>;
}

export interface MockSeed {
  /** 登录用户 uid,fake ConnectManager 会用 */
  currentUid: string;
  /** 当前 spaceId,给 orgData.space_id 用 */
  spaceId: string;
  users: MockUserSeed[];
  groups: MockGroupSeed[];
  conversations: MockConversationSeed[];
  messages?: MockMessageSeed[];
  subscribers?: MockSubscriberSeed[];
}
