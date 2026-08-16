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
});
