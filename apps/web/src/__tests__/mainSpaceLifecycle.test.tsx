import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = { space_id: "org-A", name: "Org A", role: 1 };
const ORG_B = { space_id: "org-B", name: "Org B", role: 1 };

const ctx = vi.hoisted(() => ({
  getMySpaces: vi.fn<() => Promise<typeof ORG_A[]>>(),
  toast: { error: vi.fn() },
  persistActiveSpace: vi.fn(),
  requestSwitch: vi.fn<(apply: () => void) => boolean>(),
  app: {
    loginInfo: { uid: "user-a", sessionRevision: 1, token: "test-token" },
    shared: {
      currentSpaceId: "", spaceRevision: 0, spaceChecked: false,
      notifyListener: vi.fn(),
    },
    remoteConfig: { addConfigChangeListener: vi.fn(() => vi.fn()) },
    apiClient: { config: { originRevision: 0, apiURL: "https://api.invalid" } },
    menus: { setRefresh: undefined as (() => void) | undefined },
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  },
}));

vi.mock("../../../../packages/dmworkbase/src/App", () => ({ default: ctx.app }));
vi.mock("@octo/base", async () => ({
  ...await import("../../../../packages/dmworkbase/src/im-runtime/conversationSyncContext"),
  ...await import("../../../../packages/dmworkbase/src/im-runtime/spaceContext"),
  WKApp: ctx.app,
  WKLayout: () => null,
  Provider: () => null,
  WKModal: () => null,
  t: (key: string) => key,
  Dap: { shared: { track: vi.fn() } },
  SpaceService: { shared: { getMySpaces: ctx.getMySpaces } },
  SpaceCreate: () => null,
  NavRail: () => null,
  MeInfo: () => null,
  JoinSpaceModalConnected: () => null,
  consumeJoinSuccessNotice: () => null,
  showJoinSuccessToast: vi.fn(),
  isSpaceAdminOrOwner: () => false,
  I18nContext: React.createContext({}),
}));
vi.mock("@octo/mail", () => ({ requestMailWorkspaceSwitch: ctx.requestSwitch }));
vi.mock("@douyinfe/semi-ui", () => ({ Toast: ctx.toast }));
vi.mock("../Pages/Main/vm", () => ({ default: class {} }));
vi.mock("../Pages/Main/EmptyStateIllustration", () => ({ EmptyStateIllustration: () => null }));
vi.mock("../Components/Onboarding", () => ({ Onboarding: () => null }));
vi.mock("../Components/Onboarding/content", () => ({
  defaultOnboardingConfig: {}, shouldShowOnboarding: () => false,
}));
vi.mock("../features/spacePreference", () => ({
  persistActiveSpace: ctx.persistActiveSpace,
  clearLastSpaceId: vi.fn(),
  resolveInitialSpaceForUser: (spaces: typeof ORG_A[], _uid: string, previous: string) =>
    spaces.find(space => space.space_id === previous) || spaces[0],
}));

import { MainPage } from "../Pages/Main";

const pages: MainPage[] = [];

function createPage() {
  const page = new MainPage({});
  const setState = vi.spyOn(page, "setState").mockImplementation((update) => {
    const patch = typeof update === "function" ? update(page.state, page.props) : update;
    page.state = { ...page.state, ...patch };
  });
  vi.spyOn(page, "forceUpdate").mockImplementation(() => {});
  pages.push(page);
  return { page, setState };
}

function deferredSpaces() {
  let resolve!: (spaces: typeof ORG_A[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof ORG_A[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flushResponses() {
  await Promise.resolve();
  await Promise.resolve();
}

function clearEffects() {
  ctx.app.mittBus.emit.mockClear();
  ctx.app.shared.notifyListener.mockClear();
  ctx.persistActiveSpace.mockClear();
  ctx.toast.error.mockClear();
}

function expectNoEffects() {
  expect(ctx.app.mittBus.emit).not.toHaveBeenCalled();
  expect(ctx.app.shared.notifyListener).not.toHaveBeenCalled();
  expect(ctx.persistActiveSpace).not.toHaveBeenCalled();
  expect(ctx.toast.error).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  ctx.getMySpaces.mockReset();
  ctx.requestSwitch.mockReset().mockImplementation(apply => { apply(); return true; });
  ctx.app.shared.currentSpaceId = "org-A";
  ctx.app.shared.spaceChecked = false;
  ctx.app.loginInfo.token = "test-token";
  ctx.app.loginInfo.sessionRevision++;
});

afterEach(() => {
  for (const page of pages.splice(0)) page.componentWillUnmount();
  vi.restoreAllMocks();
});

describe("MainPage asynchronous space lifecycle", () => {
  it("an unmounted instance cannot change the cached org before its replacement resolves", async () => {
    const old = deferredSpaces();
    const current = deferredSpaces();
    ctx.getMySpaces.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = createPage();
    first.page.componentDidMount();
    first.page.componentWillUnmount();
    const second = createPage();
    second.page.componentDidMount();

    old.resolve([ORG_B]);
    await flushResponses();
    expect(first.setState).not.toHaveBeenCalled();
    expect(ctx.app.shared.currentSpaceId).toBe("org-A");
    expectNoEffects();

    current.resolve([ORG_B]);
    await flushResponses();
    expect(second.page.state.allSpaces).toEqual([ORG_B]);
    expect(ctx.app.shared.currentSpaceId).toBe("org-B");
    expect(ctx.persistActiveSpace).toHaveBeenCalledWith("user-a", "org-B");
    expect(ctx.app.mittBus.emit).toHaveBeenCalledWith("space-changed", ORG_B);
    expect(ctx.app.mittBus.emit).toHaveBeenCalledWith("space-ready", ORG_B);
  });

  it("StrictMode remount of the same instance rejects the previous mount's response", async () => {
    const old = deferredSpaces();
    const current = deferredSpaces();
    ctx.getMySpaces.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { page, setState } = createPage();
    page.componentDidMount();
    page.componentWillUnmount();
    page.componentDidMount();
    old.resolve([ORG_B]);
    await flushResponses();
    expect(setState).not.toHaveBeenCalled();
    expectNoEffects();
    current.resolve([ORG_B]);
    await flushResponses();
    expect(setState).toHaveBeenCalledOnce();
    expect(page.state.allSpaces).toEqual([ORG_B]);
  });

  it.each(["resolve", "reject"] as const)("ignores refresh %s after unmount", async (outcome) => {
    const pending = deferredSpaces();
    ctx.getMySpaces.mockResolvedValueOnce([ORG_A]).mockReturnValueOnce(pending.promise);
    const { page, setState } = createPage();
    page.componentDidMount();
    await flushResponses();
    page.handleSpaceSelected("org-B");
    expect(ctx.getMySpaces).toHaveBeenCalledTimes(2);
    page.componentWillUnmount();
    clearEffects();
    setState.mockClear();
    if (outcome === "resolve") pending.resolve([ORG_A, ORG_B]);
    else pending.reject(new Error("offline"));
    await flushResponses();
    expect(setState).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it("drops the older space response but applies the current one", async () => {
    const old = deferredSpaces();
    const current = deferredSpaces();
    ctx.getMySpaces.mockResolvedValueOnce([ORG_A])
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { page, setState } = createPage();
    page.componentDidMount();
    await flushResponses();
    page.handleSpaceSelected("org-B");
    page.handleSpaceSelected("org-A");
    setState.mockClear();
    clearEffects();
    old.resolve([ORG_B]);
    await flushResponses();
    expect(setState).not.toHaveBeenCalled();
    expectNoEffects();
    current.resolve([ORG_A, ORG_B]);
    await flushResponses();
    expect(page.state.allSpaces).toEqual([ORG_A, ORG_B]);
  });

  it("leaves a same-space selection unchanged", async () => {
    ctx.getMySpaces.mockResolvedValueOnce([ORG_A]);
    const { page } = createPage();
    page.componentDidMount();
    await flushResponses();
    clearEffects();
    page.handleSpaceSelected("org-A");
    expect(ctx.getMySpaces).toHaveBeenCalledOnce();
    expect(ctx.requestSwitch).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it("does not apply a deferred workspace confirmation after unmount", async () => {
    ctx.getMySpaces.mockResolvedValueOnce([ORG_A]);
    const { page } = createPage();
    page.componentDidMount();
    await flushResponses();
    let apply!: () => void;
    ctx.requestSwitch.mockImplementation(callback => { apply = callback; return false; });
    page.handleSpaceSelected("org-B");
    page.componentWillUnmount();
    clearEffects();
    apply();
    expect(ctx.getMySpaces).toHaveBeenCalledOnce();
    expect(ctx.app.shared.currentSpaceId).toBe("org-A");
    expectNoEffects();
  });
});
