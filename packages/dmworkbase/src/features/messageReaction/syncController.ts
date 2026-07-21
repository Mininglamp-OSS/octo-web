import {
  maxMessageReactionSeq,
  mergeMessageReaction,
  type MessageReaction,
  type SyncedMessageReaction,
  type SyncMessageReactionsRequest,
} from "../../Service/MessageReactionService";

interface ReactionChannel {
  channelID: string;
  channelType: number;
}

function objectField(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

export function messageReactionCommandSeq(
  command: string,
  param: unknown,
  channel: ReactionChannel
): number | undefined {
  if (
    command !== "syncMessageReaction" ||
    !param ||
    typeof param !== "object"
  ) {
    return undefined;
  }
  const channelId = objectField(param, "channel_id");
  const channelType = objectField(param, "channel_type");
  const seq = objectField(param, "seq");
  if (
    channelId !== channel.channelID ||
    channelType !== channel.channelType ||
    typeof seq !== "number" ||
    !Number.isFinite(seq) ||
    seq <= 0
  ) {
    return undefined;
  }
  return seq;
}

export interface ReactionSyncMessageTarget {
  messageID: string;
  octoReactions?: MessageReaction[];
}

interface MessageReactionSyncDependencies {
  channel: ReactionChannel;
  getMessages: () => ReactionSyncMessageTarget[];
  sync: (
    request: SyncMessageReactionsRequest
  ) => Promise<SyncedMessageReaction[]>;
  notify: () => void;
}

function sameReaction(
  left: MessageReaction | undefined,
  right: MessageReaction
): boolean {
  return Boolean(
    left &&
      left.seq === right.seq &&
      left.name === right.name &&
      left.isDeleted === right.isDeleted &&
      left.createdAt === right.createdAt
  );
}

export function createMessageReactionSyncController(
  dependencies: MessageReactionSyncDependencies
) {
  let cursor = 0;
  let requestedSeq = 0;
  let inFlight: Promise<void> | undefined;

  const maxKnownSeq = (): number => {
    let max = cursor;
    for (const message of dependencies.getMessages()) {
      max = Math.max(max, maxMessageReactionSeq(message.octoReactions));
    }
    return max;
  };

  const apply = (record: SyncedMessageReaction): boolean => {
    if (
      record.channelId !== dependencies.channel.channelID ||
      record.channelType !== dependencies.channel.channelType
    ) {
      return false;
    }
    const target = dependencies
      .getMessages()
      .find((message) => message.messageID === record.messageId);
    if (!target) return false;

    const incoming: MessageReaction = {
      seq: record.seq,
      uid: record.uid,
      name: record.name,
      reactionType: record.reactionType,
      reactionKey: record.reactionKey,
      emoji: record.emoji,
      sticker: record.sticker,
      isDeleted: record.isDeleted,
      createdAt: record.createdAt,
    };
    const existing = (target.octoReactions ?? []).find(
      (reaction) =>
        reaction.uid === incoming.uid &&
        reaction.reactionType === incoming.reactionType &&
        reaction.reactionKey === incoming.reactionKey
    );
    if (
      typeof existing?.seq === "number" &&
      typeof incoming.seq === "number" &&
      incoming.seq < existing.seq
    ) {
      return false;
    }
    if (sameReaction(existing, incoming)) return false;
    target.octoReactions = mergeMessageReaction(target.octoReactions, incoming);
    return true;
  };

  const syncUntil = async (targetSeq: number): Promise<boolean> => {
    cursor = maxKnownSeq();
    if (cursor >= targetSeq) return false;

    let changed = false;
    let progressed = false;
    while (cursor < targetSeq) {
      const startSeq = cursor;
      const records = await dependencies.sync({
        channelId: dependencies.channel.channelID,
        channelType: dependencies.channel.channelType,
        seq: startSeq,
      });
      if (records.length === 0) break;

      let nextSeq = startSeq;
      for (const record of records) {
        if (typeof record.seq === "number" && record.seq > nextSeq) {
          nextSeq = record.seq;
        }
        changed = apply(record) || changed;
      }
      if (nextSeq <= startSeq) break;
      cursor = nextSeq;
      progressed = true;
    }
    if (changed) dependencies.notify();
    return progressed;
  };

  const drain = async (): Promise<void> => {
    while (true) {
      const targetSeq = requestedSeq;
      const progressed = await syncUntil(targetSeq);
      if (requestedSeq <= targetSeq || maxKnownSeq() >= requestedSeq) return;
      if (!progressed) return;
    }
  };

  return {
    request(seq: number): Promise<void> {
      if (!Number.isFinite(seq) || seq <= 0) return Promise.resolve();
      requestedSeq = Math.max(requestedSeq, seq);
      if (maxKnownSeq() >= requestedSeq) return inFlight ?? Promise.resolve();
      if (!inFlight) {
        inFlight = drain().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
  };
}
