import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ChatContentPageProps } from "../Pages/Chat";

const state = vi.hoisted(() => ({
  render: vi.fn(),
  register: vi.fn(),
  unread: 1,
  spaceId: "space-a",
  hasConversation: true,
  conversations: [] as Array<any>,
  conversationEvents: [] as Array<{ action: "add" | "update"; conversation: any }>,
  nextTimestamp: 0,
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {},
  Message: class {},
  WKSDK: { shared: () => ({
    conversationManager: {
      findConversation: (channel: any) =>
        state.conversations.find(
          (conversation) =>
            conversation.channel.getChannelKey() === channel.getChannelKey()
        ) ||
        (state.hasConversation
          ? { unread: state.unread, lastMessage: { messageSeq: 10 } }
          : undefined),
      createEmptyConversation: (channel: any) => {
        const existing = state.conversations.find(
          (conversation) =>
            conversation.channel.getChannelKey() === channel.getChannelKey()
        ) ||
          (state.hasConversation
            ? { channel, unread: state.unread, lastMessage: { messageSeq: 10 } }
            : undefined);
        if (existing) {
          existing.timestamp = ++state.nextTimestamp;
          state.conversationEvents.push({ action: "update", conversation: existing });
          return existing;
        }

        const conversation = { channel, unread: 0, timestamp: ++state.nextTimestamp };
        state.conversations.unshift(conversation);
        state.conversationEvents.push({ action: "add", conversation });
        return conversation;
      },
    },
  }) },
}));
vi.mock("../App", () => ({
  default: {
    shared: { get currentSpaceId() { return state.spaceId; } },
    mittBus: { emit: vi.fn() },
    routeRight: { replaceToRoot: state.render },
  },
}));
vi.mock("../Service/Module", () => ({
  EndpointManager: { shared: { setMethod: state.register } },
}));
vi.mock("../Pages/Chat", () => ({ ChatContentPage: () => null }));
vi.mock("../features/channelSearch/feature", () => ({ isChannelSearchEnabled: () => true }));

import { EndpointCommon, type ShowConversationOptions } from "../EndpointCommon";

function setup() {
  new EndpointCommon();
  const callback = state.register.mock.calls[0][1];
  return (id: string, opts: ShowConversationOptions = {}) => {
    callback({ channel: { getChannelKey: () => `${id}-2` }, opts });
    return state.render.mock.lastCall![0] as ReactElement<ChatContentPageProps>;
  };
}

describe("host conversation presentation identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.unread = 1;
    state.spaceId = "space-a";
    state.hasConversation = true;
    state.conversations = [];
    state.conversationEvents = [];
    state.nextTimestamp = 0;
  });

  it("preserves the composer key and location when unread changes during a presentation-only transition", () => {
    const open = setup();
    const embedded = open("group");
    expect(embedded.key).toBe("group-2-9");
    state.unread = 0;
    const full = open("group", { preserveCurrentConversation: true });
    expect(full.key).toBe(embedded.key);
    expect(full.props.initLocateMessageSeq).toBe(9);
    expect(full.props.workspaceEmbedding).toBeUndefined();
  });

  it("updates a mounted conversation in place for a presentation-only transition", () => {
    const open = setup();
    const embedded = open("group", {
      workspaceEmbedding: {
        openConversation: vi.fn(),
        onSidePanelUnavailable: vi.fn(),
      },
    });
    const page = { updateWorkspaceEmbedding: vi.fn() };
    (embedded as any).ref(page);
    state.unread = 0;

    open("group", { preserveCurrentConversation: true });

    expect(page.updateWorkspaceEmbedding).toHaveBeenCalledWith(undefined, undefined);
    expect(state.render).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary Web unread-location behavior unchanged", () => {
    const open = setup();
    expect(open("group").key).toBe("group-2-9");
    state.unread = 0;
    expect(open("group").key).toBe("group-2");
  });

  it("never reuses another channel or Space identity", () => {
    const open = setup();
    open("group");
    state.unread = 0;
    expect(open("other", { preserveCurrentConversation: true }).key).toBe("other-2");
    state.unread = 1;
    open("group");
    state.spaceId = "space-b";
    state.unread = 0;
    expect(open("group", { preserveCurrentConversation: true }).key).toBe("group-2");
  });

  it("retains explicit message navigation and search semantics", () => {
    const open = setup();
    open("group");
    state.unread = 0;
    expect(open("group", { preserveCurrentConversation: true, initLocateMessageSeq: 4 }).key).toBe("group-2-4");
    const search = open("group", { preserveCurrentConversation: true, openChannelSearch: true });
    expect(search.key).toBe("group-2");
    expect(search.props.initialShowChannelSearch).toBe(true);
  });

  it("acknowledges only the latest rendered conversation, never its dispatch", () => {
    const open = setup();
    const oldCommit = vi.fn();
    const nextCommit = vi.fn();
    const old = open("group", { onCommitted: oldCommit });
    const next = open("other", { onCommitted: nextCommit });
    expect(oldCommit).not.toHaveBeenCalled();
    expect(nextCommit).not.toHaveBeenCalled();
    (old as any).ref({ updateWorkspaceEmbedding: vi.fn() });
    expect(oldCommit).not.toHaveBeenCalled();
    (next as any).ref({ updateWorkspaceEmbedding: vi.fn() });
    expect(nextCommit).toHaveBeenCalledTimes(1);
    (next as any).ref(null);
    expect(nextCommit).toHaveBeenCalledTimes(1);
  });

  it.each(["route", "unmount", "space"])("rejects a delayed in-place acknowledgement after %s changes", (change) => {
    const open = setup();
    const first = open("group");
    let finish!: () => void;
    (first as any).ref({
      updateWorkspaceEmbedding: (_: unknown, callback: () => void) => { finish = callback; },
    });
    const onCommitted = vi.fn();
    open("group", { preserveCurrentConversation: true, onCommitted });
    expect(onCommitted).not.toHaveBeenCalled();
    if (change === "route") open("other");
    else if (change === "unmount") (first as any).ref(null);
    else state.spaceId = "space-b";
    finish();
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("acknowledges an in-place update only from its completion callback", () => {
    const open = setup();
    const first = open("group");
    let finish!: () => void;
    (first as any).ref({
      updateWorkspaceEmbedding: (_: unknown, callback: () => void) => { finish = callback; },
    });
    const onCommitted = vi.fn();
    open("group", { preserveCurrentConversation: true, onCommitted });
    expect(onCommitted).not.toHaveBeenCalled();
    expect(state.render).toHaveBeenCalledTimes(1);
    finish();
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("creates or promotes a formal SDK conversation for an external open", () => {
    new EndpointCommon();
    const callback = state.register.mock.calls.at(-1)![1];
    const channel = { getChannelKey: () => "external-2" } as any;
    const priorChannel = { getChannelKey: () => "prior-2" } as any;

    state.hasConversation = false;
    state.conversations = [{ channel: priorChannel, unread: 0, timestamp: 1 }];
    callback({ channel, opts: {} });
    expect(state.conversations[0]).toEqual(
      expect.objectContaining({ channel, unread: 0 })
    );
    expect(state.conversations[1].channel).toBe(priorChannel);
    expect(state.conversationEvents).toEqual([
      expect.objectContaining({ action: "add" }),
    ]);

    const initialTimestamp = state.conversations[0].timestamp;
    state.conversationEvents = [];
    callback({ channel, opts: {} });
    expect(state.conversations).toHaveLength(2);
    expect(state.conversations[0].timestamp).toBeGreaterThan(initialTimestamp);
    expect(state.conversationEvents).toEqual([
      expect.objectContaining({ action: "update", conversation: state.conversations[0] }),
    ]);

    state.conversationEvents = [];
    callback({ channel, opts: { fromSidebarList: true } });
    expect(state.conversationEvents).toEqual([]);
  });
});
