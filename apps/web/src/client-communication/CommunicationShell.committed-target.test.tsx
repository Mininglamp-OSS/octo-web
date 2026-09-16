import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OctoBuddyCommunicationBridge, HostCommand, ConversationTarget } from "./hostBridge";

const state = vi.hoisted(() => {
  const route = () => ({
    setReplaceToRoot: (_view: any) => {},
    setPush: (_view: any) => {},
    setPop: () => {},
    setPopToRoot: () => {},
    replaceToRoot(view: any) { this.setReplaceToRoot(view); },
    push(view: any) { this.setPush(view); },
    pop() { this.setPop(); },
    popToRoot() { this.setPopToRoot(); },
  });
  return {
    app: {
      shared: {
        currentSpaceId: "space-a",
        openChannel: undefined as any,
        pendingAttachmentGuard: undefined as (() => boolean) | undefined,
        addListener: () => () => {},
        notifyListener: () => {},
      },
      routeLeft: route(),
      routeRight: route(),
      endpoints: undefined as any,
      currentMenuId: "chat",
      switchToMenuById: undefined as any,
      mittBus: { emit: vi.fn() },
      config: {},
      loginInfo: { logout: vi.fn() },
    },
    handler: undefined as any,
    mounts: 0,
    unmounts: 0,
    unread: 1,
    holdRoutes: false,
    routes: [] as Array<() => void>,
    holdUpdates: false,
    updates: [] as Array<() => void>,
    confirm: vi.fn(() => ({ destroy: vi.fn() })),
  };
});

vi.mock("@octo/base/src/App", () => ({ default: state.app }));
vi.mock("@octo/base/src/Service/Module", () => ({
  EndpointManager: { shared: {
    setMethod: (_id: string, callback: any) => { state.handler = callback; },
    invoke: (_id: string, input: any) => state.handler(input),
  } },
}));
vi.mock("@octo/base/src/features/channelSearch/feature", () => ({ isChannelSearchEnabled: () => true }));
vi.mock("@octo/base/src/Components/WKModal", () => ({ wkConfirm: state.confirm }));
vi.mock("@octo/base/src/Components/WKNavHeader", () => ({ default: () => null }));
vi.mock("@octo/contacts", () => ({ ContactsList: () => <div data-testid="contacts" /> }));
vi.mock("@dmwork/appbot/conversation", () => ({
  renderAppBotConversation: (target: { channelId: string }) => <div>{target.channelId}</div>,
}));
vi.mock("./summaryNavigation", () => ({ installSummaryNavigation: () => () => {} }));
vi.mock("./documentForward", () => ({ installDocumentForward: () => () => {} }));
vi.mock("./summaryRequests", () => ({ installSummaryRequests: () => () => {} }));
vi.mock("wukongimjssdk", () => ({
  Channel: class {
    constructor(public channelID: string, public channelType: number) {}
    getChannelKey() { return `${this.channelID}-${this.channelType}`; }
  },
  ChannelInfo: class {},
  WKSDK: { shared: () => ({ conversationManager: {
    findConversation: () => ({ unread: state.unread, lastMessage: { messageSeq: 10 } }),
  } }) },
}));

// Keep EndpointCommon and WKViewQueue real. Only the business page is reduced to stateful DOM.
vi.mock("@octo/base/src/Pages/Chat", () => ({
  ChatContentPage: class extends React.Component<any, { embedding: any }> {
    state = { embedding: this.props.workspaceEmbedding };
    componentDidMount() { state.mounts++; }
    componentWillUnmount() { state.unmounts++; }
    updateWorkspaceEmbedding(embedding: any, onCommitted?: () => void) {
      const commit = () => this.setState({ embedding }, onCommitted);
      if (state.holdUpdates) state.updates.push(commit);
      else commit();
    }
    render() {
      return <section data-testid="conversation" data-channel={this.props.channel.channelID}
        data-embedded={Boolean(this.state.embedding)}>
        <input aria-label="draft" defaultValue="" />
        <div data-testid="messages" style={{ overflow: "auto", height: 100 }}>messages</div>
      </section>;
    }
  },
}));

vi.mock("@octo/base", async () => {
  const { default: Queue } = await import("@octo/base/src/Components/WKViewQueue");
  return {
    WKApp: state.app,
    ChatPage: () => <div>chat sidebar</div>,
    WKBase: ({ children }: any) => children,
    WKLayout: ({ contentLeft, contentRight, onLeftContext, onRightContext }: any) => <>
      <Queue onContext={onLeftContext}>{contentLeft}</Queue>
      <Queue onContext={(context) => onRightContext({
        replaceToRoot: (view: JSX.Element) => {
          const commit = () => context.replaceToRoot(view);
          if (state.holdRoutes) state.routes.push(commit);
          else commit();
        },
        push: (view: JSX.Element) => context.push(view),
        pop: () => context.pop(),
        popToRoot: () => context.popToRoot(),
      })}>{contentRight}</Queue>
    </>,
    getCurrentImChannelInfo: () => undefined,
    setCurrentImChannelInfoCache: () => {},
    findCurrentImConversation: () => undefined,
    createCurrentEmptyImConversation: () => {},
    getCurrentImUnreadObserver: () => ({ subscribe: () => () => {} }),
    applyImSpaceContext: (space: { space_id: string }) => { state.app.shared.currentSpaceId = space.space_id; },
    i18n: { setLocale: () => {} },
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
    ThemeMode: {},
  };
});

import { Channel } from "wukongimjssdk";
import { EndpointCommon } from "@octo/base/src/EndpointCommon";
import { CommunicationShell } from "./CommunicationShell";

function makeBridge() {
  let listener: ((command: HostCommand) => void) | undefined;
  const report = vi.fn(async (_payload: { navigationId: number }) => {});
  const bridge = {
    onCommand: (next: typeof listener) => {
      listener = next;
      return () => { if (listener === next) listener = undefined; };
    },
    reportNavigationCommitted: report,
    reportNavigation: vi.fn(async () => {}),
    reportUnread: vi.fn(),
  } as unknown as OctoBuddyCommunicationBridge;
  return { bridge, report, dispatch: (command: HostCommand) => listener?.(command) };
}

const target = (channelId = "b"): ConversationTarget => ({ channelId, channelType: 2 });
const element = (bridge: OctoBuddyCommunicationBridge) => <CommunicationShell
  bridge={bridge} initialPage="chat" initialPresentation="workspace"
  initialSpaceId="space-a" runtimeOwned onReady={async () => {}} />;
type TestBridge = ReturnType<typeof makeBridge>;

async function navigate(host: TestBridge, navigationId?: number, value = target()) {
  await act(async () => host.dispatch({
    type: "navigate", page: "chat", target: value,
    presentation: value.variant === "workspace-group" ? "conversation" : "workspace",
    ...(navigationId === undefined ? {} : { navigationId }),
  }));
}

function editDraft() {
  const input = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "unsaved draft" } });
  const messages = screen.getByTestId("messages");
  messages.scrollTop = 37;
  return { input, messages };
}

function expectPreserved(saved: ReturnType<typeof editDraft>) {
  expect(screen.getByRole("textbox")).toBe(saved.input);
  expect(saved.input.value).toBe("unsaved draft");
  expect(screen.getByTestId("messages")).toBe(saved.messages);
  expect(saved.messages.scrollTop).toBe(37);
}

describe("communication committed target identity through real routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mounts = state.unmounts = 0;
    state.unread = 1;
    state.holdRoutes = state.holdUpdates = false;
    state.routes = [];
    state.updates = [];
    state.app.shared.openChannel = undefined;
    state.app.shared.pendingAttachmentGuard = undefined;
    state.app.shared.currentSpaceId = "space-a";
    state.app.endpoints = new EndpointCommon();
  });

  it.each(["sidebar", "legacy"])("preserves an %s-opened conversation when host acknowledgement is requested", async (source) => {
    const host = makeBridge();
    render(element(host.bridge));
    if (source === "sidebar") {
      act(() => state.app.endpoints.showConversation(new Channel("b", 2), { fromSidebarList: true }));
    } else await navigate(host);
    const saved = editDraft();
    state.unread = 0;

    await navigate(host, 1);
    await waitFor(() => expect(host.report).toHaveBeenCalledExactlyOnceWith({ navigationId: 1 }));
    expectPreserved(saved);
    expect(state.mounts).toBe(1);
    expect(state.unmounts).toBe(0);
    await navigate(host);
    expectPreserved(saved);
  });

  it("acknowledges repeated host ids without remounting or redispatching the committed conversation", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await navigate(host, 1);
    const saved = editDraft();
    const open = vi.spyOn(state.app.endpoints, "showConversation");
    await navigate(host, 2);
    await waitFor(() => expect(host.report.mock.calls).toEqual([[{ navigationId: 1 }], [{ navigationId: 2 }]]));
    expect(open).not.toHaveBeenCalled();
    expectPreserved(saved);
    expect(state.mounts).toBe(1);
  });

  it("acknowledges the live internal channel after leaving a workspace target", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await navigate(host, undefined, { ...target("workspace"), variant: "workspace-group" });
    act(() => state.app.endpoints.showConversation(new Channel("b", 2), { fromSidebarList: true }));
    const saved = editDraft();
    const mounts = state.mounts;
    await navigate(host, 2);
    await waitFor(() => expect(host.report).toHaveBeenCalledExactlyOnceWith({ navigationId: 2 }));
    expectPreserved(saved);
    expect(state.mounts).toBe(mounts);
  });

  it("waits for in-place workspace updates, even when a host supplies an id", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await navigate(host, 1);
    const saved = editDraft();
    state.holdUpdates = true;
    const workspace = { ...target(), variant: "workspace-group" as const };
    await navigate(host, 2, workspace);
    expect(state.updates).toHaveLength(1);
    expect(host.report).not.toHaveBeenCalledWith({ navigationId: 2 });
    expect(screen.getByTestId("conversation").dataset.embedded).toBe("false");
    await act(async () => state.updates.shift()!());
    await waitFor(() => expect(host.report).toHaveBeenCalledWith({ navigationId: 2 }));
    expect(screen.getByTestId("conversation").dataset.embedded).toBe("true");
    expectPreserved(saved);
    await navigate(host, 3, workspace);
    await waitFor(() => expect(host.report).toHaveBeenCalledWith({ navigationId: 3 }));
    expect(state.updates).toHaveLength(0);
    state.holdUpdates = false;
    await navigate(host, 4);
    await waitFor(() => expect(host.report).toHaveBeenCalledWith({ navigationId: 4 }));
    expect(screen.getByTestId("conversation").dataset.embedded).toBe("false");
    expectPreserved(saved);
    expect(state.mounts).toBe(1);
  });

  it("does not mistake dispatched openChannel or a held legacy route for a DOM commit", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await navigate(host, undefined, target("a"));
    state.holdRoutes = true;
    await navigate(host);
    expect(state.app.shared.openChannel.channelID).toBe("b");
    expect(screen.getByTestId("conversation").dataset.channel).toBe("a");
    await navigate(host, 2);
    expect(state.routes).toHaveLength(2);
    expect(host.report).not.toHaveBeenCalled();
    await act(async () => state.routes.shift()!());
    expect(host.report).not.toHaveBeenCalled();
    await act(async () => state.routes.shift()!());
    await waitFor(() => expect(host.report).toHaveBeenCalledExactlyOnceWith({ navigationId: 2 }));
    expect(screen.getByTestId("conversation").dataset.channel).toBe("b");
  });

  it("does not reuse a committed target while its presentation has an outstanding update", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await navigate(host, 1);
    const saved = editDraft();
    state.holdUpdates = true;
    await navigate(host, 2, { ...target(), variant: "workspace-group" });
    await navigate(host, 3);
    expect(state.updates).toHaveLength(2);
    expect(host.report).not.toHaveBeenCalledWith({ navigationId: 3 });
    await act(async () => state.updates.shift()!());
    expect(host.report).not.toHaveBeenCalledWith({ navigationId: 2 });
    expect(host.report).not.toHaveBeenCalledWith({ navigationId: 3 });
    await act(async () => state.updates.shift()!());
    await waitFor(() => expect(host.report).toHaveBeenCalledWith({ navigationId: 3 }));
    expect(screen.getByTestId("conversation").dataset.embedded).toBe("false");
    expectPreserved(saved);
  });

  it("only acknowledges the final committed target in a held A-B-A sequence", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    state.holdRoutes = true;
    await navigate(host, 1, target("a"));
    await navigate(host, 2, target("b"));
    await navigate(host, 3, target("a"));
    for (let i = 0; i < 2; i++) {
      await act(async () => state.routes.shift()!());
      expect(host.report).not.toHaveBeenCalled();
    }
    await act(async () => state.routes.shift()!());
    await waitFor(() => expect(host.report).toHaveBeenCalledExactlyOnceWith({ navigationId: 3 }));
    expect(screen.getByTestId("conversation").dataset.channel).toBe("a");
  });

  it("does not acknowledge an in-place update hidden by a newer internal route", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await navigate(host, 1);
    state.holdUpdates = true;
    await navigate(host, 2, { ...target(), variant: "workspace-group" });
    act(() => state.app.routeRight.push(<div data-testid="detail">detail</div>));
    await act(async () => state.updates.shift()!());
    expect(host.report).not.toHaveBeenCalledWith({ navigationId: 2 });
    state.holdUpdates = false;
    await navigate(host, 3);
    await waitFor(() => expect(host.report).toHaveBeenCalledWith({ navigationId: 3 }));
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("keeps an old bridge's held callback from releasing a new controller with a reused token", async () => {
    const old = makeBridge();
    const shell = render(element(old.bridge));
    state.holdRoutes = true;
    await navigate(old, 1);
    const next = makeBridge();
    shell.rerender(element(next.bridge));
    await navigate(next, 2);
    await act(async () => state.routes.shift()!());
    expect(old.report).not.toHaveBeenCalled();
    expect(next.report).not.toHaveBeenCalled();
    await act(async () => state.routes.shift()!());
    await waitFor(() => expect(next.report).toHaveBeenCalledExactlyOnceWith({ navigationId: 2 }));
    expect(old.report).not.toHaveBeenCalled();
  });

  it.each(["suspend", "menu", "space"])("invalidates a held commit on %s", async (action) => {
    const host = makeBridge();
    render(element(host.bridge));
    state.holdRoutes = true;
    await navigate(host, 1);
    act(() => {
      if (action === "menu") state.app.switchToMenuById("contacts");
      else if (action === "space") {
        host.dispatch({ type: "spaceChanged", space: { id: "space-b", name: "B" } });
        host.dispatch({ type: "spaceChanged", space: { id: "space-a", name: "A" } });
      } else host.dispatch({ type: "suspend" });
    });
    await act(async () => state.routes.shift()!());
    expect(host.report).not.toHaveBeenCalled();
  });

  it("acknowledges a contacts-only page commit", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await act(async () => host.dispatch({ type: "navigate", page: "contacts", navigationId: 1 }));
    await waitFor(() => expect(host.report).toHaveBeenCalledExactlyOnceWith({ navigationId: 1 }));
    expect(screen.queryByTestId("conversation")).toBeNull();
  });

  it("never acknowledges a workspace selection cancelled by the user", async () => {
    const host = makeBridge();
    render(element(host.bridge));
    await navigate(host);
    const saved = editDraft();
    state.app.shared.pendingAttachmentGuard = () => false;
    await navigate(host, 2, { ...target("other"), variant: "workspace-group" });
    expect(state.confirm).toHaveBeenCalledTimes(1);
    act(() => (state.confirm.mock.calls[0] as any)[0].onCancel());
    expect(host.report).not.toHaveBeenCalled();
    expectPreserved(saved);
  });
});
