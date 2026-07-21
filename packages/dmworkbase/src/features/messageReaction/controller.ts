import {
  mergeMessageReaction,
  type MessageReaction,
  type ToggleMessageReactionRequest,
  type ToggleMessageReactionResult,
} from "../../Service/MessageReactionService";

export const MESSAGE_REACTION_UPDATED_EVENT =
  "message-reaction-updated" as const;

export interface MessageReactionTarget {
  messageID: string;
  channel: {
    channelID: string;
    channelType: number;
  };
  octoReactions?: MessageReaction[];
}

interface CurrentReactionUser {
  uid: string;
  name: string;
}

export interface MessageReactionControllerDependencies {
  toggle: (
    request: ToggleMessageReactionRequest
  ) => Promise<ToggleMessageReactionResult>;
  currentUser: () => CurrentReactionUser | undefined;
  emitUpdated: (messageId: string) => void;
  showError: (key: string) => void;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if (
    "normalized" in error &&
    error.normalized &&
    typeof error.normalized === "object"
  ) {
    const normalized = error.normalized;
    if ("code" in normalized && typeof normalized.code === "string") {
      return normalized.code;
    }
  }
  return undefined;
}

export function getReactionErrorKey(error: unknown): string {
  switch (errorCode(error)) {
    case "err.server.message.channel_access_denied":
      return "base.reaction.noPermission";
    case "err.server.message.reaction_unsupported_type":
      return "base.reaction.textOnly";
    case "err.server.message.group_disbanded":
    case "err.server.message.not_found":
      return "base.reaction.unavailable";
    default:
      return "base.reaction.failed";
  }
}

function findOwnReaction(
  reactions: readonly MessageReaction[],
  uid: string,
  emoji: string
): MessageReaction | undefined {
  return reactions.find(
    (reaction) =>
      reaction.uid === uid &&
      reaction.reactionType === "emoji" &&
      reaction.reactionKey === emoji
  );
}

function applyOwnState(
  reactions: readonly MessageReaction[],
  user: CurrentReactionUser,
  emoji: string,
  isDeleted: 0 | 1,
  seq?: number
): MessageReaction[] {
  const existing = findOwnReaction(reactions, user.uid, emoji);
  return mergeMessageReaction(reactions, {
    ...existing,
    uid: user.uid,
    name: user.name,
    reactionType: "emoji",
    reactionKey: emoji,
    emoji,
    isDeleted,
    seq: seq ?? existing?.seq,
  });
}

function rollbackOwnState(
  reactions: readonly MessageReaction[],
  user: CurrentReactionUser,
  emoji: string,
  previous: MessageReaction | undefined
): MessageReaction[] {
  const current = findOwnReaction(reactions, user.uid, emoji);
  if (previous) {
    if (
      typeof current?.seq === "number" &&
      typeof previous.seq === "number" &&
      current.seq > previous.seq
    ) {
      return [...reactions];
    }
    return mergeMessageReaction(reactions, previous);
  }
  if (typeof current?.seq === "number") {
    return [...reactions];
  }
  return reactions.filter(
    (reaction) =>
      !(
        reaction.uid === user.uid &&
        reaction.reactionType === "emoji" &&
        reaction.reactionKey === emoji
      )
  );
}

export function createMessageReactionController(
  dependencies: MessageReactionControllerDependencies
) {
  const pending = new Map<string, Promise<void>>();

  const toggle = (
    message: MessageReactionTarget,
    emoji: string
  ): Promise<void> => {
    const user = dependencies.currentUser();
    if (!user || !message.messageID || !emoji) {
      return Promise.resolve();
    }

    const pendingKey = `${message.channel.channelType}\u0000${message.channel.channelID}\u0000${message.messageID}\u0000${emoji}`;
    const existingRequest = pending.get(pendingKey);
    if (existingRequest) return existingRequest;

    const previous = findOwnReaction(
      message.octoReactions ?? [],
      user.uid,
      emoji
    );
    const optimisticDeleted: 0 | 1 = previous?.isDeleted === 0 ? 1 : 0;
    message.octoReactions = applyOwnState(
      message.octoReactions ?? [],
      user,
      emoji,
      optimisticDeleted
    );
    dependencies.emitUpdated(message.messageID);

    const request = dependencies
      .toggle({
        messageId: message.messageID,
        channelId: message.channel.channelID,
        channelType: message.channel.channelType,
        emoji,
      })
      .then((result) => {
        message.octoReactions = applyOwnState(
          message.octoReactions ?? [],
          user,
          emoji,
          result.isDeleted,
          result.seq
        );
        dependencies.emitUpdated(message.messageID);
      })
      .catch((error: unknown) => {
        message.octoReactions = rollbackOwnState(
          message.octoReactions ?? [],
          user,
          emoji,
          previous
        );
        dependencies.emitUpdated(message.messageID);
        dependencies.showError(getReactionErrorKey(error));
      })
      .finally(() => {
        pending.delete(pendingKey);
      });

    pending.set(pendingKey, request);
    return request;
  };

  return {
    toggle,
    selectedKeys(message: MessageReactionTarget): string[] {
      const user = dependencies.currentUser();
      if (!user) return [];
      return Array.from(
        new Set(
          (message.octoReactions ?? [])
            .filter(
              (reaction) =>
                reaction.uid === user.uid &&
                reaction.reactionType === "emoji" &&
                reaction.isDeleted !== 1
            )
            .map((reaction) => reaction.reactionKey)
        )
      );
    },
  };
}
