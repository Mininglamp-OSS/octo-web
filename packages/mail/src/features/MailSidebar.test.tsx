// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMailbox } from "../bridge/types";

const state = vi.hoisted(() => ({
  replaceToRoot: vi.fn(),
  handlers: new Map<string, (payload?: { menuId?: string }) => void>(),
  viewProps: null as {
    onSelectAgentMailbox: (mailbox: AgentMailbox) => void;
  } | null,
  navigation: {} as Record<string, unknown>,
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: (key: string) => key }),
  WKApp: {
    currentMenuId: "mail",
    routeRight: { replaceToRoot: state.replaceToRoot },
    mittBus: {
      on: vi.fn(
        (event: string, handler: (payload?: { menuId?: string }) => void) =>
          state.handlers.set(event, handler)
      ),
      off: vi.fn((event: string) => state.handlers.delete(event)),
      emit: vi.fn(),
    },
  },
}));

vi.mock("../bridge/useMailNavigation", () => ({
  default: () => state.navigation,
}));

vi.mock("../ui/MailSidebarView", () => ({
  default: (props: typeof state.viewProps) => {
    state.viewProps = props;
    return null;
  },
}));

vi.mock("./MailRecordsFeature", () => ({
  default: () => null,
}));

vi.mock("./MailAddressManagementFeature", () => ({
  default: () => null,
}));

import {
  registerAgentMailboxSwitchGuard,
  replaceAgentMailboxContext,
  requestAgentMailboxSwitch,
  resetAgentMailboxContextForTests,
} from "../bridge/mailboxContext";
import MailSidebar from "./MailSidebar";

const first: AgentMailbox = {
  id: "11",
  address: "first@mail.imocto.cn",
  connectState: "connected",
  outboundMode: "manual_confirmation",
};
const second: AgentMailbox = {
  id: "12",
  address: "second@mail.imocto.cn",
  connectState: "connected",
  outboundMode: "manual_confirmation",
};

describe("MailSidebar deferred mailbox navigation", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    state.handlers.clear();
    resetAgentMailboxContextForTests();
    replaceAgentMailboxContext({ spaceId: "space-a", mailbox: first });
    state.viewProps = null;
    state.navigation = {
      agentMailboxes: [first, second],
      selectedAgentMailbox: first,
      mailboxes: [],
      loading: false,
      error: "",
      reload: vi.fn(),
      selectAgentMailbox: (mailbox: AgentMailbox, afterSwitch?: () => void) =>
        requestAgentMailboxSwitch({ spaceId: "space-a", mailbox }, afterSwitch),
    };
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    resetAgentMailboxContextForTests();
  });

  it("replaces the pane only after the dirty composer confirms the switch", () => {
    act(() => root.render(<MailSidebar />));
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);

    let confirmDiscard: (() => boolean) | undefined;
    registerAgentMailboxSwitchGuard((proceed) => {
      confirmDiscard = proceed;
      return false;
    });

    act(() => state.viewProps?.onSelectAgentMailbox(second));
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);

    act(() => {
      confirmDiscard?.();
    });
    expect(state.replaceToRoot).toHaveBeenCalledTimes(2);
    const replacement = state.replaceToRoot.mock
      .calls[1]?.[0] as React.ReactElement;
    expect(replacement.key).toBe("12");
  });

  it("releases the Mail-only preferred width on programmatic menu changes", () => {
    const widths: Array<number | null | undefined> = [];
    const captureWidth = (event: Event) => {
      widths.push(
        (event as CustomEvent<{ width?: number | null }>).detail?.width
      );
    };
    window.addEventListener("wk:layout-left-width", captureWidth);

    act(() => root.render(<MailSidebar />));
    expect(widths).toEqual([250]);

    act(() =>
      state.handlers.get("wk:active-menu-changed")?.({ menuId: "chat" })
    );
    expect(widths).toEqual([250, null]);

    window.removeEventListener("wk:layout-left-width", captureWidth);
  });
});
