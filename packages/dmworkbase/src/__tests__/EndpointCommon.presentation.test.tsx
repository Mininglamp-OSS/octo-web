import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ChatContentPageProps } from "../Pages/Chat";

const state = vi.hoisted(() => ({
  render: vi.fn(),
  register: vi.fn(),
  unread: 1,
  spaceId: "space-a",
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {},
  Message: class {},
  WKSDK: { shared: () => ({
    conversationManager: { findConversation: () => ({
      unread: state.unread, lastMessage: { messageSeq: 10 },
    }) },
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

    expect(page.updateWorkspaceEmbedding).toHaveBeenCalledWith(undefined);
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
});
