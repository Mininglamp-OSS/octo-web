import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  setMethod: vi.fn(),
  notifyListener: vi.fn(),
  switchToMenuById: vi.fn(),
  currentMenuId: "mail",
  openChannel: undefined as unknown,
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {},
  WKSDK: { shared: vi.fn() },
  Message: class {},
}));

vi.mock("../App", () => ({
  default: {
    shared: {
      get openChannel() {
        return state.openChannel;
      },
      set openChannel(value: unknown) {
        state.openChannel = value;
      },
      notifyListener: state.notifyListener,
    },
    get currentMenuId() {
      return state.currentMenuId;
    },
    get switchToMenuById() {
      return state.switchToMenuById;
    },
    mittBus: { emit: vi.fn() },
    routeRight: { replaceToRoot: vi.fn() },
  },
}));

vi.mock("../Service/Module", () => ({
  EndpointManager: {
    shared: {
      invoke: state.invoke,
      setMethod: state.setMethod,
      invokes: vi.fn(),
    },
  },
}));

vi.mock("../Pages/Chat", () => ({ ChatContentPage: () => null }));
vi.mock("../features/channelSearch/feature", () => ({
  isChannelSearchEnabled: () => false,
}));

import { EndpointCommon } from "../EndpointCommon";

describe("EndpointCommon guarded menu switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    state.currentMenuId = "mail";
    state.openChannel = undefined;
  });

  it("opens a notification conversation only after the menu switch succeeds", () => {
    let afterSwitch: (() => void) | undefined;
    state.switchToMenuById.mockImplementation(
      (_menuId: string, next?: () => void) => {
        afterSwitch = next;
      }
    );
    const channel = { id: "channel-1" };

    new EndpointCommon().showConversation(channel as never);

    expect(state.switchToMenuById).toHaveBeenCalledWith(
      "chat",
      expect.any(Function)
    );
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.openChannel).toBeUndefined();

    afterSwitch?.();
    expect(state.invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(state.openChannel).toBe(channel);
  });

  it("does not open the conversation when the guarded switch is vetoed", () => {
    state.switchToMenuById.mockImplementation(() => undefined);

    new EndpointCommon().showConversation({ id: "channel-1" } as never);
    vi.runAllTimers();

    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.openChannel).toBeUndefined();
  });
});
