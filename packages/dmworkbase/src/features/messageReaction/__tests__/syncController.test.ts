import { describe, expect, it, vi } from "vitest";
import {
  createMessageReactionSyncController,
  messageReactionCommandSeq,
} from "../syncController";
import type { SyncedMessageReaction } from "../../../Service/MessageReactionService";

const channel = { channelID: "group-1", channelType: 2 };

function message(messageID: string, octoReactions: any[] = []) {
  return { messageID, octoReactions };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function syncedReaction(
  seq: number,
  overrides: Partial<SyncedMessageReaction> = {}
): SyncedMessageReaction {
  return {
    messageId: "123",
    channelId: "group-1",
    channelType: 2,
    seq,
    uid: `u${seq}`,
    name: `User ${seq}`,
    reactionType: "emoji",
    reactionKey: "👍",
    emoji: "👍",
    isDeleted: 0,
    ...overrides,
  };
}

describe("message reaction realtime sync controller", () => {
  it("accepts only syncMessageReaction for the active channel with a positive seq", () => {
    expect(
      messageReactionCommandSeq(
        "syncMessageReaction",
        { channel_id: "group-1", channel_type: 2, seq: 42 },
        channel
      )
    ).toBe(42);
    expect(
      messageReactionCommandSeq(
        "syncMessageReaction",
        { channel_id: "other", channel_type: 2, seq: 42 },
        channel
      )
    ).toBeUndefined();
    expect(
      messageReactionCommandSeq(
        "messageReaction",
        { channel_id: "group-1", channel_type: 2, seq: 42 },
        channel
      )
    ).toBeUndefined();
    expect(
      messageReactionCommandSeq(
        "syncMessageReaction",
        { channel_id: "group-1", channel_type: 2, seq: 0 },
        channel
      )
    ).toBeUndefined();
  });

  it("syncs from the highest inline seq and applies message-scoped records", async () => {
    const messages = [
      message("123", [
        {
          seq: 40,
          uid: "u1",
          name: "Alice",
          reactionType: "emoji",
          reactionKey: "👍",
          emoji: "👍",
          isDeleted: 0,
        },
      ]),
    ];
    const sync = vi.fn().mockResolvedValue([
      {
        messageId: "123",
        channelId: "group-1",
        channelType: 2,
        seq: 42,
        uid: "u2",
        name: "Bob",
        reactionType: "emoji",
        reactionKey: "❤️",
        emoji: "❤️",
        isDeleted: 0,
      },
    ]);
    const notify = vi.fn();
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify,
    });

    await controller.request(42);

    expect(sync).toHaveBeenCalledWith({
      channelId: "group-1",
      channelType: 2,
      seq: 40,
    });
    expect(messages[0].octoReactions).toEqual([
      expect.objectContaining({ uid: "u1", seq: 40 }),
      expect.objectContaining({ uid: "u2", seq: 42 }),
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("ignores an announced seq already represented by inline data", async () => {
    const messages = [
      message("123", [
        {
          seq: 42,
          uid: "u1",
          name: "Alice",
          reactionType: "emoji",
          reactionKey: "👍",
          emoji: "👍",
          isDeleted: 0,
        },
      ]),
    ];
    const sync = vi.fn();
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify: vi.fn(),
    });

    await controller.request(42);

    expect(sync).not.toHaveBeenCalled();
  });

  it("keeps a newer local record when sync returns an older seq", async () => {
    const messages = [
      message("123", [
        {
          seq: 50,
          uid: "u1",
          name: "Alice",
          reactionType: "emoji",
          reactionKey: "👍",
          emoji: "👍",
          isDeleted: 0,
        },
      ]),
    ];
    const sync = vi.fn().mockResolvedValue([
      {
        messageId: "123",
        channelId: "group-1",
        channelType: 2,
        seq: 49,
        uid: "u1",
        name: "Alice",
        reactionType: "emoji",
        reactionKey: "👍",
        emoji: "👍",
        isDeleted: 1,
      },
    ]);
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify: vi.fn(),
    });

    await controller.request(51);

    expect(messages[0].octoReactions[0]).toEqual(
      expect.objectContaining({ seq: 50, isDeleted: 0 })
    );
  });

  it("continues across multiple sync batches until the announced seq is reached", async () => {
    const messages = [message("123")];
    const sync = vi
      .fn()
      .mockResolvedValueOnce([syncedReaction(41, { uid: "u1" })])
      .mockResolvedValueOnce([
        syncedReaction(43, {
          uid: "u2",
          reactionKey: "❤️",
          emoji: "❤️",
        }),
      ]);
    const notify = vi.fn();
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify,
    });

    await controller.request(43);

    expect(sync).toHaveBeenNthCalledWith(1, {
      channelId: "group-1",
      channelType: 2,
      seq: 0,
    });
    expect(sync).toHaveBeenNthCalledWith(2, {
      channelId: "group-1",
      channelType: 2,
      seq: 41,
    });
    expect(messages[0].octoReactions).toEqual([
      expect.objectContaining({ uid: "u1", seq: 41 }),
      expect.objectContaining({ uid: "u2", seq: 43 }),
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("drains a newer command that arrives while an earlier sync is in flight", async () => {
    const firstBatch = deferred<SyncedMessageReaction[]>();
    const messages = [message("123")];
    const sync = vi
      .fn()
      .mockReturnValueOnce(firstBatch.promise)
      .mockResolvedValueOnce([
        syncedReaction(45, {
          uid: "u2",
          reactionKey: "❤️",
          emoji: "❤️",
        }),
      ]);
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync,
      notify: vi.fn(),
    });

    const first = controller.request(42);
    const second = controller.request(45);
    firstBatch.resolve([syncedReaction(42, { uid: "u1" })]);
    await Promise.all([first, second]);

    expect(sync).toHaveBeenNthCalledWith(1, {
      channelId: "group-1",
      channelType: 2,
      seq: 0,
    });
    expect(sync).toHaveBeenNthCalledWith(2, {
      channelId: "group-1",
      channelType: 2,
      seq: 42,
    });
    expect(messages[0].octoReactions).toEqual([
      expect.objectContaining({ uid: "u1", seq: 42 }),
      expect.objectContaining({ uid: "u2", seq: 45 }),
    ]);
  });

  it("applies a record when its message becomes available during the sync", async () => {
    const batch = deferred<SyncedMessageReaction[]>();
    const messages: ReturnType<typeof message>[] = [];
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => messages,
      sync: vi.fn(() => batch.promise),
      notify: vi.fn(),
    });

    const pending = controller.request(42);
    messages.push(message("123"));
    batch.resolve([syncedReaction(42)]);
    await pending;

    expect(messages[0].octoReactions).toEqual([
      expect.objectContaining({ uid: "u42", seq: 42 }),
    ]);
  });

  it("stops on an empty batch and allows a later command to retry", async () => {
    const sync = vi.fn().mockResolvedValue([]);
    const controller = createMessageReactionSyncController({
      channel,
      getMessages: () => [message("123")],
      sync,
      notify: vi.fn(),
    });

    await controller.request(42);
    await controller.request(42);

    expect(sync).toHaveBeenCalledTimes(2);
  });
});
