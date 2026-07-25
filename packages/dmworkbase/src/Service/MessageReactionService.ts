import APIClient from "./APIClient";

export type MessageReactionType = "emoji" | "sticker";

export interface MessageReactionSticker {
  stickerId?: string;
  path: string;
  format?: string;
  placeholder?: string;
}

export interface MessageReaction {
  seq?: number;
  uid: string;
  name: string;
  reactionType: MessageReactionType;
  reactionKey: string;
  emoji?: string;
  sticker?: MessageReactionSticker;
  isDeleted?: 0 | 1;
  createdAt?: string;
}

export interface MessageReactionGroup {
  reactionType: MessageReactionType;
  reactionKey: string;
  emoji?: string;
  sticker?: MessageReactionSticker;
  users: MessageReactionUser[];
  hasMine: boolean;
  latestSeq?: number;
}

export interface MessageReactionUser {
  uid: string;
  name: string;
}

export interface ToggleMessageReactionRequest {
  messageId: string;
  channelId: string;
  channelType: number;
  emoji: string;
}

export interface ToggleMessageReactionResult {
  messageId: string;
  channelId: string;
  channelType: number;
  emoji: string;
  seq: number;
  isDeleted: 0 | 1;
}

export interface SyncMessageReactionsRequest {
  channelId: string;
  channelType: number;
  seq: number;
}

export interface SyncedMessageReaction extends MessageReaction {
  messageId: string;
  channelId: string;
  channelType: number;
}

interface MessageReactionWire {
  message_id?: unknown;
  channel_id?: unknown;
  channel_type?: unknown;
  seq?: unknown;
  uid?: unknown;
  name?: unknown;
  emoji?: unknown;
  is_deleted?: unknown;
  created_at?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function deletedFlag(value: unknown): 0 | 1 {
  return value === 1 ? 1 : 0;
}

function normalizeMessageReaction(value: unknown): MessageReaction | undefined {
  if (!isRecord(value)) return undefined;
  const wire: MessageReactionWire = value;
  const uid = typeof wire.uid === "string" ? wire.uid : "";
  const emoji = typeof wire.emoji === "string" ? wire.emoji : "";
  if (!uid || !emoji) return undefined;

  return {
    seq: finiteNumber(wire.seq),
    uid,
    name:
      typeof wire.name === "string" && wire.name.length > 0 ? wire.name : uid,
    reactionType: "emoji",
    reactionKey: emoji,
    emoji,
    isDeleted: deletedFlag(wire.is_deleted),
    createdAt:
      typeof wire.created_at === "string" ? wire.created_at : undefined,
  };
}

export function normalizeMessageReactions(value: unknown): MessageReaction[] {
  if (!Array.isArray(value)) return [];
  const reactions: MessageReaction[] = [];
  for (const item of value) {
    const normalized = normalizeMessageReaction(item);
    if (normalized) reactions.push(normalized);
  }
  return reactions;
}

function normalizeSyncedReaction(
  value: unknown
): SyncedMessageReaction | undefined {
  if (!isRecord(value)) return undefined;
  const reaction = normalizeMessageReaction(value);
  const messageId =
    typeof value.message_id === "string" ? value.message_id : "";
  const channelId =
    typeof value.channel_id === "string" ? value.channel_id : "";
  const channelType = finiteNumber(value.channel_type);
  if (!reaction || !messageId || !channelId || channelType === undefined) {
    return undefined;
  }
  return {
    messageId,
    channelId,
    channelType,
    ...reaction,
  };
}

function normalizeToggleResult(value: unknown): ToggleMessageReactionResult {
  if (!isRecord(value)) {
    throw new Error("Invalid message reaction response");
  }
  const messageId =
    typeof value.message_id === "string" ? value.message_id : "";
  const channelId =
    typeof value.channel_id === "string" ? value.channel_id : "";
  const channelType = finiteNumber(value.channel_type);
  const emoji = typeof value.emoji === "string" ? value.emoji : "";
  const seq = finiteNumber(value.seq);
  if (
    !messageId ||
    !channelId ||
    channelType === undefined ||
    !emoji ||
    seq === undefined
  ) {
    throw new Error("Invalid message reaction response");
  }
  return {
    messageId,
    channelId,
    channelType,
    emoji,
    seq,
    isDeleted: deletedFlag(value.is_deleted),
  };
}

export function mergeMessageReaction(
  current: readonly MessageReaction[] | undefined,
  incoming: MessageReaction
): MessageReaction[] {
  const next = current ? [...current] : [];
  const index = next.findIndex(
    (item) =>
      item.uid === incoming.uid &&
      item.reactionType === incoming.reactionType &&
      item.reactionKey === incoming.reactionKey
  );
  if (index < 0) {
    next.push(incoming);
    return next;
  }

  const existingSeq = next[index].seq;
  if (
    typeof existingSeq === "number" &&
    typeof incoming.seq === "number" &&
    incoming.seq < existingSeq
  ) {
    return next;
  }
  next[index] = incoming;
  return next;
}

export function maxMessageReactionSeq(
  reactions: readonly MessageReaction[] | undefined
): number {
  let max = 0;
  for (const reaction of reactions ?? []) {
    if (typeof reaction.seq === "number" && reaction.seq > max) {
      max = reaction.seq;
    }
  }
  return max;
}

const MessageReactionService = {
  async toggle(
    request: ToggleMessageReactionRequest
  ): Promise<ToggleMessageReactionResult> {
    const response = await APIClient.shared.post("reactions", {
      message_id: request.messageId,
      channel_id: request.channelId,
      channel_type: request.channelType,
      emoji: request.emoji,
    });
    return normalizeToggleResult(response);
  },

  async sync(
    request: SyncMessageReactionsRequest
  ): Promise<SyncedMessageReaction[]> {
    const response = await APIClient.shared.post("reaction/sync", {
      channel_id: request.channelId,
      channel_type: request.channelType,
      seq: request.seq,
    });
    if (!Array.isArray(response)) return [];
    const reactions: SyncedMessageReaction[] = [];
    for (const item of response) {
      const normalized = normalizeSyncedReaction(item);
      if (normalized) reactions.push(normalized);
    }
    return reactions;
  },
};

export default MessageReactionService;
