import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import {
  Channel,
  ChannelTypeGroup,
  type Subscriber,
} from "wukongimjssdk";
import { createChatSendOutcome } from "../../domain";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";

vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: {
      commonDataSource: { getImageURL: vi.fn(() => "") },
    },
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
}));

function conversationContext(channelId: string) {
  return {
    channel: () => new Channel(channelId, ChannelTypeGroup),
  } as any;
}

function member(uid: string, name: string): Subscriber {
  return { uid, name, orgData: {} } as Subscriber;
}

describe("ChatComposer mention isolation", () => {
  it("uses the owning composer member list when multiple instances are mounted", async () => {
    let firstContext: MessageInputContext | undefined;
    let secondContext: MessageInputContext | undefined;
    const firstSend = vi.fn(() =>
      createChatSendOutcome({ editorConsumed: true }),
    );
    const secondSend = vi.fn(() =>
      createChatSendOutcome({ editorConsumed: true }),
    );

    render(
      <>
        <ChatComposer
          context={conversationContext("first")}
          members={[member("alice", "Alice")]}
          onContext={(context) => {
            firstContext = context;
          }}
          onSend={firstSend}
        />
        <ChatComposer
          context={conversationContext("second")}
          members={[member("bob", "Bob")]}
          onContext={(context) => {
            secondContext = context;
          }}
          onSend={secondSend}
        />
      </>,
    );

    await waitFor(() => {
      expect(firstContext).toBeDefined();
      expect(secondContext).toBeDefined();
    });
    act(() => firstContext?.addMention("alice", "Alice"));

    await act(async () => {
      await firstContext?.send();
    });

    expect(firstSend).toHaveBeenCalledWith(
      expect.objectContaining({
        mention: expect.objectContaining({ uids: ["alice"] }),
        editorBlocks: [
          expect.objectContaining({
            type: "text",
            mention: expect.objectContaining({ uids: ["alice"] }),
          }),
        ],
      }),
    );
    expect(secondSend).not.toHaveBeenCalled();
  });
});
