import { describe, expect, it, vi } from "vitest";
import {
  createMessageReactionController,
  getReactionErrorKey,
} from "../controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function target(reactions: any[] = []) {
  return {
    messageID: "123",
    channel: { channelID: "group-1", channelType: 2 },
    octoReactions: reactions,
  };
}

describe("message reaction controller", () => {
  it("applies an optimistic add then reconciles with the authoritative response", async () => {
    const request = deferred<{
      messageId: string;
      channelId: string;
      channelType: number;
      emoji: string;
      seq: number;
      isDeleted: 0 | 1;
    }>();
    const emitUpdated = vi.fn();
    const toggle = vi.fn(() => request.promise);
    const controller = createMessageReactionController({
      toggle,
      currentUser: () => ({ uid: "me", name: "Me" }),
      emitUpdated,
      showError: vi.fn(),
    });
    const message = target();

    const pending = controller.toggle(message, "👍");
    expect(message.octoReactions).toEqual([
      expect.objectContaining({
        uid: "me",
        reactionKey: "👍",
        isDeleted: 0,
      }),
    ]);
    expect(emitUpdated).toHaveBeenCalledWith("123");

    request.resolve({
      messageId: "123",
      channelId: "group-1",
      channelType: 2,
      emoji: "👍",
      seq: 42,
      isDeleted: 0,
    });
    await pending;

    expect(message.octoReactions).toEqual([
      expect.objectContaining({ uid: "me", reactionKey: "👍", seq: 42 }),
    ]);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("rolls back only the current user's emoji and preserves concurrent records", async () => {
    const request = deferred<never>();
    const showError = vi.fn();
    const controller = createMessageReactionController({
      toggle: vi.fn(() => request.promise),
      currentUser: () => ({ uid: "me", name: "Me" }),
      emitUpdated: vi.fn(),
      showError,
    });
    const message = target([
      {
        seq: 10,
        uid: "me",
        name: "Me",
        reactionType: "emoji",
        reactionKey: "👍",
        emoji: "👍",
        isDeleted: 0,
      },
    ]);

    const pending = controller.toggle(message, "👍");
    message.octoReactions.push({
      seq: 11,
      uid: "other",
      name: "Other",
      reactionType: "emoji",
      reactionKey: "❤️",
      emoji: "❤️",
      isDeleted: 0,
    });
    request.reject({ code: "err.server.message.channel_access_denied" });
    await pending;

    expect(message.octoReactions).toEqual([
      expect.objectContaining({ uid: "me", reactionKey: "👍", isDeleted: 0 }),
      expect.objectContaining({ uid: "other", reactionKey: "❤️" }),
    ]);
    expect(showError).toHaveBeenCalledWith("base.reaction.noPermission");
  });

  it("deduplicates a second local toggle while the same message and emoji are pending", async () => {
    const request = deferred<any>();
    const toggle = vi.fn(() => request.promise);
    const controller = createMessageReactionController({
      toggle,
      currentUser: () => ({ uid: "me", name: "Me" }),
      emitUpdated: vi.fn(),
      showError: vi.fn(),
    });
    const message = target();

    const first = controller.toggle(message, "👍");
    const second = controller.toggle(message, "👍");
    expect(toggle).toHaveBeenCalledTimes(1);
    request.resolve({
      messageId: "123",
      channelId: "group-1",
      channelType: 2,
      emoji: "👍",
      seq: 42,
      isDeleted: 0,
    });
    await Promise.all([first, second]);
  });

  it("maps deployed error codes instead of HTTP transport status", () => {
    expect(
      getReactionErrorKey({
        status: 400,
        code: "err.server.message.reaction_unsupported_type",
      })
    ).toBe("base.reaction.textOnly");
    expect(
      getReactionErrorKey({ code: "err.server.message.group_disbanded" })
    ).toBe("base.reaction.unavailable");
    expect(getReactionErrorKey({ code: "rate.limited" })).toBe(
      "base.reaction.failed"
    );
  });
});
