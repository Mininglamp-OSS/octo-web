import { Channel, Subscriber } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribersRequest } = vi.hoisted(() => ({
  subscribersRequest: vi.fn(),
}));

vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      channelDataSource: {
        subscribers: subscribersRequest,
      },
    },
  },
}));

import { SubscriberListVM } from "../list_vm";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("SubscriberListVM local search", () => {
  const channel = { channelID: "group-1", channelType: 2 } as Channel;
  const localResult = [{ uid: "weijiaoying", name: "魏娇莹" }] as Subscriber[];

  beforeEach(() => {
    subscribersRequest.mockReset();
  });

  it("uses local search for a non-empty keyword", () => {
    const localSearch = vi.fn(() => localResult);
    const vm = new SubscriberListVM(channel, undefined, localSearch);
    (vm as any)._isMounted = true;

    vm.search("weijiao");

    expect(localSearch).toHaveBeenCalledWith("weijiao");
    expect(vm.subscribers).toEqual(localResult);
    expect(vm.hasMore).toBe(false);
    expect(subscribersRequest).not.toHaveBeenCalled();
  });

  it("falls back to the existing server request for an empty keyword", async () => {
    subscribersRequest.mockResolvedValue(localResult);
    const vm = new SubscriberListVM(channel, undefined, vi.fn());
    (vm as any)._isMounted = true;

    vm.search("");
    await vi.waitFor(() => expect(subscribersRequest).toHaveBeenCalledOnce());

    expect(vm.subscribers).toEqual(localResult);
  });

  it("does not let an older server response overwrite local results", async () => {
    const pending = deferred<Subscriber[]>();
    subscribersRequest.mockReturnValue(pending.promise);
    const vm = new SubscriberListVM(channel, undefined, () => localResult);
    (vm as any)._isMounted = true;

    const request = vm.requestSubscribers();
    vm.search("weijiao");
    pending.resolve([{ uid: "stale", name: "Stale" }] as Subscriber[]);
    await request;

    expect(vm.subscribers).toEqual(localResult);
  });
});
