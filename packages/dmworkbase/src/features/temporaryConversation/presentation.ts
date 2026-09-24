import { Channel, Conversation, ConversationExtra } from "wukongimjssdk";
import { ConversationWrap } from "../../Service/Model";

export type TemporaryConversationEntry =
  | { channel: Channel; origin: "existing" }
  | { channel: Channel; origin: "virtual"; conversation: ConversationWrap };

export interface TemporaryConversationScrollRequest {
  token: number;
  /** Kept independently of temporary placement so list refreshes can restore ordering. */
  channel: Channel;
}

export interface TemporaryConversationState {
  /** The only temporary item, kept until replaced, released, or dismissed. */
  active?: TemporaryConversationEntry;
}

export interface TemporaryConversationPresentation {
  conversations: ConversationWrap[];
  virtualChannelKeys: Set<string>;
}

function isSameChannel(left: Channel | undefined, right: Channel | undefined) {
  return !!left && !!right &&
    left.channelID === right.channelID && left.channelType === right.channelType;
}

/**
 * Every external open replaces the previous temporary item, including when
 * the target already belongs to the conversation list.
 */
export function openTemporaryConversation(
  state: TemporaryConversationState,
  channel: Channel,
  hasConversation: (channel: Channel) => boolean,
): TemporaryConversationState {
  if (isSameChannel(state.active?.channel, channel)) return state;

  return {
    active: hasConversation(channel)
      ? { channel, origin: "existing" }
      : { channel, origin: "virtual", conversation: createVirtualConversation(channel) },
  };
}

/** Handles a list click without manufacturing a new temporary pin. */
export function leaveTemporaryConversation(
  state: TemporaryConversationState,
  nextChannel: Channel,
  hasConversation: (channel: Channel) => boolean,
): TemporaryConversationState {
  const active = state.active;
  if (!active || isSameChannel(active.channel, nextChannel)) return state;

  // An existing conversation remains in its temporary placement while the
  // user switches chats.  Its position is restored only after the next list
  // refresh, so switching does not make the row disappear unexpectedly.
  return active.origin === "existing" ||
    (active.origin === "virtual" && !hasConversation(active.channel))
    ? state
    : {};
}

/** A refreshed list is authoritative for the original position of real rows. */
export function refreshTemporaryConversation(
  state: TemporaryConversationState,
): TemporaryConversationState {
  return state.active?.origin === "existing" ? {} : state;
}

/** Dismiss only the matching item so a late menu action cannot clear a new one. */
export function dismissTemporaryConversation(
  state: TemporaryConversationState,
  channel: Channel,
): TemporaryConversationState {
  return isSameChannel(state.active?.channel, channel) ? {} : state;
}

/** Sending a message releases temporary presentation for either origin. */
export function promoteTemporaryConversation(
  state: TemporaryConversationState,
  channel: Channel,
): TemporaryConversationState {
  return dismissTemporaryConversation(state, channel);
}

function createVirtualConversation(channel: Channel): ConversationWrap {
  const conversation = new Conversation();
  conversation.channel = channel;
  conversation.timestamp = 0;
  conversation.unread = 0;
  // ConversationList reads remoteExtra.draft unconditionally for normal rows.
  conversation.remoteExtra = new ConversationExtra();
  conversation.remoteExtra.draft = "";
  return new ConversationWrap(conversation);
}

/**
 * Resolves temporary state into rows that ConversationList can insert after
 * its real pinned segment.  A real conversation replaces a virtual row as
 * soon as a message arrives, preventing duplicates.
 */
export function buildTemporaryConversationPresentation(
  state: TemporaryConversationState,
  findConversation: (channel: Channel) => ConversationWrap | undefined,
): TemporaryConversationPresentation {
  const conversations: ConversationWrap[] = [];
  const virtualChannelKeys = new Set<string>();

  const entry = state.active;
  if (entry) {
    const current = findConversation(entry.channel);
    if (current) {
      conversations.push(current);
    } else if (entry.origin === "virtual") {
      // Menu actions update this object (notably thread extra.top). Keep it
      // for the entry's lifetime rather than discarding those writes on render.
      conversations.push(entry.conversation);
      virtualChannelKeys.add(entry.channel.getChannelKey());
    }
  }
  return { conversations, virtualChannelKeys };
}
