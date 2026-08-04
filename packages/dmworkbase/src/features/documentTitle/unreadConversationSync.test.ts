import { describe, expect, it, vi } from "vitest";
import {
  UnreadConversationSync,
  type UnreadConversationSyncChannel,
  type UnreadConversationUpdate,
} from "./unreadConversationSync";

class FakeChannel implements UnreadConversationSyncChannel {
  onmessage: ((event: MessageEvent<UnreadConversationUpdate>) => void) | null =
    null;
  postMessage = vi.fn();
  close = vi.fn();
}

describe("UnreadConversationSync", () => {
  it("broadcasts local unread changes and delivers remote changes to subscribers", () => {
    const channel = new FakeChannel();
    const sync = new UnreadConversationSync(channel);
    const listener = vi.fn();
    sync.subscribe(listener);
    const update: UnreadConversationUpdate = {
      accountId: "u1",
      spaceId: "s1",
      channelId: "g1",
      channelType: 2,
      unread: 0,
    };

    sync.publish(update);
    expect(channel.postMessage).toHaveBeenCalledWith(update);

    channel.onmessage?.({
      data: update,
    } as MessageEvent<UnreadConversationUpdate>);
    expect(listener).toHaveBeenCalledWith(update);
  });

  it("detaches from the browser channel on close", () => {
    const channel = new FakeChannel();
    const sync = new UnreadConversationSync(channel);
    sync.close();
    expect(channel.onmessage).toBeNull();
    expect(channel.close).toHaveBeenCalledOnce();
  });
});
