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

  it("shows local results immediately and preserves server keyword search", async () => {
    subscribersRequest.mockResolvedValue([]);
    const localSearch = vi.fn(() => localResult);
    const vm = new SubscriberListVM(channel, undefined, localSearch);
    (vm as any)._isMounted = true;

    vm.search("weijiao");

    expect(localSearch).toHaveBeenCalledWith("weijiao");
    expect(vm.subscribers).toEqual(localResult);
    expect(vm.hasMore).toBe(false);
    await vi.waitFor(() => expect(subscribersRequest).toHaveBeenCalledOnce());
    expect(subscribersRequest).toHaveBeenCalledWith(channel, {
      page: 1,
      limit: vm.limit,
      keyword: "weijiao",
    });
  });

  it("applies the existing subscriber filter to local search results", () => {
    const blocked = { uid: "bot", name: "Bot" } as Subscriber;
    const localSearch = vi.fn(() => [...localResult, blocked]);
    const vm = new SubscriberListVM(
      channel,
      (subscriber) => subscriber.uid !== blocked.uid,
      localSearch
    );
    (vm as any)._isMounted = true;

    vm.search("weijiao");

    expect(vm.subscribers).toEqual(localResult);
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
    subscribersRequest
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce([]);
    const vm = new SubscriberListVM(channel, undefined, () => localResult);
    (vm as any)._isMounted = true;

    const request = vm.requestSubscribers();
    vm.search("weijiao");
    pending.resolve([{ uid: "stale", name: "Stale" }] as Subscriber[]);
    await request;

    expect(vm.subscribers).toEqual(localResult);
  });

  it("merges server results when the local member cache is incomplete", async () => {
    const remoteResult = {
      uid: "member-after-first-page",
      name: "魏娇莹",
    } as Subscriber;
    subscribersRequest.mockResolvedValue([remoteResult]);
    const vm = new SubscriberListVM(channel, undefined, () => []);
    (vm as any)._isMounted = true;

    vm.search("weijiao");
    await vi.waitFor(() => expect(vm.subscribers).toEqual([remoteResult]));

    expect(subscribersRequest).toHaveBeenCalledWith(channel, {
      page: 1,
      limit: vm.limit,
      keyword: "weijiao",
    });
  });

  it("deduplicates matching members returned by local and server search", async () => {
    subscribersRequest.mockResolvedValue(localResult);
    const vm = new SubscriberListVM(channel, undefined, () => localResult);
    (vm as any)._isMounted = true;

    vm.search("weijiao");
    await vi.waitFor(() => expect(subscribersRequest).toHaveBeenCalledOnce());

    expect(vm.subscribers).toEqual(localResult);
  });

  it("applies the existing subscriber filter to merged server results", async () => {
    const blocked = { uid: "bot", name: "Bot" } as Subscriber;
    subscribersRequest.mockResolvedValue([...localResult, blocked]);
    const vm = new SubscriberListVM(
      channel,
      (subscriber) => subscriber.uid !== blocked.uid,
      () => []
    );
    (vm as any)._isMounted = true;

    vm.search("weijiao");
    await vi.waitFor(() => expect(vm.subscribers).toEqual(localResult));
  });

  it("does not let an older partial-cache search overwrite a newer search", async () => {
    const firstRequest = deferred<Subscriber[]>();
    const secondResult = [{ uid: "second", name: "Second" }] as Subscriber[];
    subscribersRequest
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(secondResult);
    const vm = new SubscriberListVM(channel, undefined, (keyword) =>
      keyword === "second"
        ? ([{ uid: "second-local", name: "Second Local" }] as Subscriber[])
        : []
    );
    (vm as any)._isMounted = true;

    vm.search("first");
    vm.search("second");
    await vi.waitFor(() => expect(subscribersRequest).toHaveBeenCalledTimes(2));
    firstRequest.resolve([{ uid: "stale", name: "Stale" }] as Subscriber[]);
    await firstRequest.promise;
    await vi.waitFor(() =>
      expect(vm.subscribers.map((subscriber) => subscriber.uid)).toEqual([
        "second-local",
        "second",
      ])
    );
  });

  it("keeps server pagination after merging partial-cache search results", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      uid: `remote-${index}`,
      name: `Remote ${index}`,
    })) as Subscriber[];
    const secondPage = [
      { uid: "remote-50", name: "Remote 50" },
    ] as Subscriber[];
    subscribersRequest
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const vm = new SubscriberListVM(channel, undefined, () => localResult);
    (vm as any)._isMounted = true;

    vm.search("wei");
    await vi.waitFor(() => expect(vm.hasMore).toBe(true));
    await vm.loadMoreSubscribersIfNeed();

    expect(subscribersRequest).toHaveBeenLastCalledWith(channel, {
      page: 2,
      limit: vm.limit,
      keyword: "wei",
    });
    expect(vm.subscribers).toHaveLength(52);
    expect(vm.hasMore).toBe(false);
  });

  it("falls back to server search if the local search callback fails", async () => {
    subscribersRequest.mockResolvedValue(localResult);
    const vm = new SubscriberListVM(channel, undefined, () => {
      throw new Error("local index failed");
    });
    (vm as any)._isMounted = true;

    vm.search("weijiao");
    await vi.waitFor(() => expect(vm.subscribers).toEqual(localResult));

    expect(subscribersRequest).toHaveBeenCalledWith(channel, {
      page: 1,
      limit: vm.limit,
      keyword: "weijiao",
    });
  });
});
