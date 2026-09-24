import { expect, it, vi } from "vitest";
import { Channel, ChannelInfo, WKSDK } from "wukongimjssdk";
import ConversationList, { isConversationPinned } from "../../../Components/ConversationList";
import { ChannelTypeCommunityTopic } from "../../../Service/Const";
import PinnedService from "../../../Service/PinnedService";
import { buildTemporaryConversationPresentation, openTemporaryConversation } from "../presentation";

vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));

it("preserves a virtual thread's saved pin across rerenders and allows unpinning", async () => {
  const sdk = WKSDK.shared();
  const channel = new Channel("temporary-pin-group____thread", ChannelTypeCommunityTopic);
  const info = new ChannelInfo();
  info.channel = channel;
  info.orgData = {};
  sdk.channelManager.setChannleInfoForCache(info);
  const state = openTemporaryConversation({}, channel, () => false);
  const present = () => buildTemporaryConversationPresentation(state, () => undefined);
  const first = present().conversations[0];
  const list = new ConversationList({ temporarilyPinnedConversations: [first] });
  vi.spyOn(list, "setState").mockImplementation(() => undefined);
  const pin = vi.spyOn(PinnedService, "add").mockResolvedValue(undefined);
  const unpin = vi.spyOn(PinnedService, "remove").mockResolvedValue(undefined);
  try {
    list.onTop(first);
    await vi.waitFor(() => expect(isConversationPinned(first)).toBe(true));
    expect(pin).toHaveBeenCalledExactlyOnceWith(channel);

    const afterRender = present();
    expect(afterRender.virtualChannelKeys.has(channel.getChannelKey())).toBe(true);
    expect(isConversationPinned(afterRender.conversations[0])).toBe(true);
    expect(sdk.conversationManager.findConversation(channel)).toBeUndefined();

    list.onTop(afterRender.conversations[0]);
    await vi.waitFor(() => expect(isConversationPinned(present().conversations[0])).toBe(false));
    expect(unpin).toHaveBeenCalledExactlyOnceWith(channel);
    expect(pin).toHaveBeenCalledOnce();
  } finally {
    sdk.channelManager.deleteChannelInfo(channel);
    vi.restoreAllMocks();
  }
});
