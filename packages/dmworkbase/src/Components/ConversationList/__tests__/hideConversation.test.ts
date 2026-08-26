import { describe, expect, it, vi } from "vitest";
import { hideConversation } from "../hideConversation";

function makeRuntime(order: string[]) {
  return {
    clearUnread: vi.fn(async () => {
      order.push("clear-unread");
    }),
    deleteConversation: vi.fn(async () => {
      order.push("delete-recent");
    }),
    removeLocalConversation: vi.fn(() => {
      order.push("remove-local");
    }),
    updateFollowingUnread: vi.fn(() => {
      order.push("update-following-unread");
    }),
    publishUnreadCleared: vi.fn(() => {
      order.push("publish-unread");
    }),
    reloadFollowingSidebar: vi.fn(() => {
      order.push("reload-following");
    }),
  };
}

describe("hideConversation", () => {
  it("ends old unread before deleting Recent and then refreshes local consumers", async () => {
    const order: string[] = [];
    const runtime = makeRuntime(order);
    const channel = { channelID: "group-a", channelType: 2 } as any;

    await hideConversation(channel, runtime);

    expect(order).toEqual([
      "clear-unread",
      "delete-recent",
      "remove-local",
      "update-following-unread",
      "publish-unread",
      "reload-following",
    ]);
  });

  it("keeps the conversation visible when unread cleanup fails", async () => {
    const order: string[] = [];
    const runtime = makeRuntime(order);
    runtime.clearUnread.mockRejectedValueOnce(new Error("clear failed"));

    await expect(
      hideConversation(
        { channelID: "group-a", channelType: 2 } as any,
        runtime
      )
    ).rejects.toThrow("clear failed");

    expect(runtime.deleteConversation).not.toHaveBeenCalled();
    expect(runtime.removeLocalConversation).not.toHaveBeenCalled();
    expect(runtime.updateFollowingUnread).not.toHaveBeenCalled();
    expect(runtime.reloadFollowingSidebar).not.toHaveBeenCalled();
  });

  it("does not remove the local conversation when server deletion fails", async () => {
    const order: string[] = [];
    const runtime = makeRuntime(order);
    runtime.deleteConversation.mockRejectedValueOnce(new Error("delete failed"));

    await expect(
      hideConversation(
        { channelID: "group-a", channelType: 2 } as any,
        runtime
      )
    ).rejects.toThrow("delete failed");

    expect(runtime.removeLocalConversation).not.toHaveBeenCalled();
    expect(runtime.updateFollowingUnread).not.toHaveBeenCalled();
    expect(runtime.publishUnreadCleared).not.toHaveBeenCalled();
    expect(runtime.reloadFollowingSidebar).not.toHaveBeenCalled();
  });
});
