import { Channel, ChannelTypeGroup, Subscriber } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubscriberStatus } from "../../../Service/Const";
import { SubscribersVM } from "../vm";

const { runtime } = vi.hoisted(() => ({
  runtime: {
    subscribers: [] as Subscriber[],
    subscriberChangeListeners: [] as Array<(channel: Channel) => void>,
    unsubscribe: vi.fn(),
  },
}));

vi.mock("../../../App", () => ({
  default: {
    loginInfo: {
      uid: "owner",
    },
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  addCurrentImSubscriberChangeListener: vi.fn((listener) => {
    runtime.subscriberChangeListeners.push(listener);
    return runtime.unsubscribe;
  }),
  getCurrentImChannelSubscribers: vi.fn(() => runtime.subscribers),
}));

describe("SubscribersVM", () => {
  const channel = new Channel("group-1", ChannelTypeGroup);

  beforeEach(() => {
    runtime.subscribers = [];
    runtime.subscriberChangeListeners = [];
    runtime.unsubscribe.mockReset();
  });

  it("refreshes route data from the current subscriber cache after member changes", () => {
    const routeData = {
      channel,
      subscribers: [
        { uid: "owner", status: SubscriberStatus.normal },
        { uid: "removed", status: SubscriberStatus.normal },
      ] as Subscriber[],
      subscriberAll: [],
      subscriberOfMe: { uid: "owner", status: SubscriberStatus.normal },
    };
    const context = {
      routeData: vi.fn(() => routeData),
    };
    const vm = new SubscribersVM(context as any);
    const listener = vi.fn();
    vm.addListener(listener);
    runtime.subscribers = [
      { uid: "owner", status: SubscriberStatus.normal },
      { uid: "kept", status: SubscriberStatus.normal },
    ] as Subscriber[];

    vm.didMount();
    expect(routeData.subscribers.map((subscriber) => subscriber.uid)).toEqual([
      "owner",
      "kept",
    ]);
    listener.mockClear();

    runtime.subscriberChangeListeners[0](channel);

    expect(routeData.subscribers.map((subscriber) => subscriber.uid)).toEqual([
      "owner",
      "kept",
    ]);
    expect(routeData.subscriberAll.map((subscriber) => subscriber.uid)).toEqual([
      "owner",
      "kept",
    ]);
    expect(routeData.subscriberOfMe?.uid).toBe("owner");
    expect(listener).toHaveBeenCalledOnce();

    vm.didUnMount();
    expect(runtime.unsubscribe).toHaveBeenCalledOnce();
  });

  it("ignores subscriber changes for other channels", () => {
    const routeData = {
      channel,
      subscribers: [{ uid: "owner", status: SubscriberStatus.normal }],
      subscriberAll: [],
    };
    const vm = new SubscribersVM({ routeData: vi.fn(() => routeData) } as any);
    const listener = vi.fn();
    vm.addListener(listener);
    runtime.subscribers = [
      { uid: "owner", status: SubscriberStatus.normal },
    ] as Subscriber[];

    vm.didMount();
    listener.mockClear();
    runtime.subscribers = [
      { uid: "owner", status: SubscriberStatus.normal },
      { uid: "other", status: SubscriberStatus.normal },
    ] as Subscriber[];

    runtime.subscriberChangeListeners[0](
      new Channel("other-group", ChannelTypeGroup)
    );

    expect(routeData.subscribers.map((subscriber) => subscriber.uid)).toEqual([
      "owner",
    ]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("reloads route data from cache on mount after a previous panel missed the change event", () => {
    const routeData = {
      channel,
      subscribers: [
        { uid: "owner", status: SubscriberStatus.normal },
        { uid: "removed", status: SubscriberStatus.normal },
      ] as Subscriber[],
      subscriberAll: [],
      subscriberOfMe: { uid: "owner", status: SubscriberStatus.normal },
    };
    runtime.subscribers = [
      { uid: "owner", status: SubscriberStatus.normal },
      { uid: "kept", status: SubscriberStatus.normal },
    ] as Subscriber[];
    const vm = new SubscribersVM({ routeData: vi.fn(() => routeData) } as any);

    vm.didMount();

    expect(routeData.subscribers.map((subscriber) => subscriber.uid)).toEqual([
      "owner",
      "kept",
    ]);
  });

  describe("showRemove", () => {
    const makeVM = (routeData: any) =>
      new SubscribersVM({ routeData: vi.fn(() => routeData) } as any);

    it("shows the remove entry for owners and managers", () => {
      for (const role of [1, 2]) {
        const vm = makeVM({
          channel,
          subscribers: [],
          subscriberAll: [],
          subscriberOfMe: { uid: "owner", role },
        });
        expect(vm.showRemove()).toBe(true);
      }
    });

    it("shows the remove entry to a normal member who owns a bot in the group", () => {
      // octo-web#1511：不加这条，普通成员在 <=19 人的群里完全没有入口 ——
      // 「查看全部」只在成员数超过 shouldShowMemberNum()（普通成员为 19）时才渲染。
      const vm = makeVM({
        channel,
        subscribers: [],
        subscriberAll: [
          { uid: "peer", role: 0 },
          { uid: "bot_mine", role: 0, orgData: { robot: 1, bot_owned_by_me: true } },
        ],
        subscriberOfMe: { uid: "me", role: 0 },
      });
      expect(vm.showRemove()).toBe(true);
    });

    it("fails closed on truthy-but-not-true bot_owned_by_me", () => {
      // 变异证明这条此前没被覆盖：把 ownsAnyRemovableBotInGroup 里的 === true
      // 放宽成 !!，22 个用例仍然全绿。/membersync 是增量同步，老缓存行不带这个
      // 字段，降级方向必须是「退回改动前」，绝不能误开入口。
      const vm = makeVM({
        channel,
        subscribers: [],
        subscriberAll: [
          { uid: "bot_truthy", role: 0, orgData: { robot: 1, bot_owned_by_me: 1 } },
          { uid: "bot_str", role: 0, orgData: { robot: 1, bot_owned_by_me: "true" } },
        ],
        subscriberOfMe: { uid: "me", role: 0 },
      });
      expect(vm.showRemove()).toBe(false);
    });

    it("hides the entry when the only owned bot holds a group role", () => {
      // 入口判据现在直接复用行判据，所以「我拥有、但担任管理员」的 bot 不再
      // 点亮入口 —— 否则会是个点进去没有任何可移除项的死胡同。
      const vm = makeVM({
        channel,
        subscribers: [],
        subscriberAll: [
          { uid: "bot_mgr", role: 2, orgData: { robot: 1, bot_owned_by_me: true } },
        ],
        subscriberOfMe: { uid: "me", role: 0 },
      });
      expect(vm.showRemove()).toBe(false);
    });

    it("hides the remove entry from a normal member with no bots of their own", () => {
      const vm = makeVM({
        channel,
        subscribers: [],
        subscriberAll: [
          { uid: "peer", role: 0 },
          { uid: "bot_theirs", role: 0, orgData: { robot: 1, bot_owned_by_me: false } },
          { uid: "bot_stale", role: 0, orgData: { robot: 1 } },
        ],
        subscriberOfMe: { uid: "me", role: 0 },
      });
      expect(vm.showRemove()).toBe(false);
    });

    it("fails closed when the member cache is empty", () => {
      const vm = makeVM({
        channel,
        subscribers: [],
        subscriberAll: [],
        subscriberOfMe: { uid: "me", role: 0 },
      });
      expect(vm.showRemove()).toBe(false);
    });
  });
});
