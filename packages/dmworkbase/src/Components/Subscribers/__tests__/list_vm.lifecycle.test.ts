import { Channel, Subscriber } from "wukongimjssdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../App", () => ({
  default: { dataSource: { channelDataSource: { subscribers: request } } },
}));
vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelLocallyRemovedSubscriberUids: () => [],
}));

import { SubscriberListVM } from "../list_vm";

function member(uid: string) {
  const result = new Subscriber();
  result.uid = uid;
  result.name = uid;
  return result;
}
function deferred() {
  let resolve!: (rows: Subscriber[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Subscriber[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const channel = new Channel("lifecycle", 2);
const mounted: SubscriberListVM[] = [];
function mount(
  filter?: (row: Subscriber) => boolean,
  search?: (keyword: string, roster?: Subscriber[]) => Subscriber[],
  maxAutoPages?: number
) {
  const vm = new SubscriberListVM(channel, filter, search, { maxAutoPages });
  vm.limit = 2;
  vm.didMount();
  mounted.push(vm);
  return vm;
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
});
afterEach(() => {
  mounted.splice(0).forEach((vm) => vm.didUnMount());
  vi.useRealTimers();
});

describe("SubscriberListVM production request lifecycle", () => {
  it("refresh supersedes an auto-page job and resumes the sparse walk", async () => {
    const stalePage = deferred();
    const emptyPage = [member("a"), member("b")];
    request
      .mockResolvedValueOnce(emptyPage)
      .mockReturnValueOnce(stalePage.promise)
      .mockResolvedValueOnce(emptyPage)
      .mockResolvedValueOnce([member("bot")]);
    const vm = mount((row) => row.uid === "bot");
    await vi.advanceTimersByTimeAsync(250);
    expect(request).toHaveBeenCalledTimes(2);
    vm.refreshCurrentSearch();
    await settle();
    stalePage.resolve(emptyPage);
    await settle();
    expect(vm.subscribers.map((row) => row.uid)).toEqual(["bot"]);
    expect(vm.loading).toBe(false);
    expect(vm.autoPaging).toBe(false);
    expect(vm.status).toBe("ready");
  });

  it("keeps no-match provisional until the authoritative search settles", async () => {
    request.mockResolvedValueOnce([member("alice")]);
    const vm = mount(undefined, () => []);
    await vi.advanceTimersByTimeAsync(250);
    const pending = deferred();
    request.mockReturnValueOnce(pending.promise);
    const states: string[] = [];
    vm.addListener(() => states.push(vm.status));
    vm.search("bob");
    expect(vm.status).toBe("loading");
    expect(states).not.toContain("ready");
    pending.resolve([member("bob")]);
    await settle();
    expect(vm.status).toBe("ready");
    expect(vm.subscribers[0].uid).toBe("bob");
  });

  it("invalidates old results immediately and covers the entire debounce window", async () => {
    request.mockResolvedValueOnce([]);
    const vm = mount();
    await vi.advanceTimersByTimeAsync(250);
    const old = deferred();
    request
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([member("all")]);
    vm.search("missing");
    vm.search("", 300);
    expect(vm.status).toBe("debouncing");
    old.resolve([member("wrong-query")]);
    await settle();
    expect(vm.subscribers).toEqual([]);
    expect(vm.status).toBe("debouncing");
    await vi.advanceTimersByTimeAsync(299);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(vm.subscribers[0].uid).toBe("all");
    expect(vm.status).toBe("ready");
  });

  it("does not allow a scroll to steal an auto-page request", async () => {
    const next = deferred();
    request
      .mockResolvedValueOnce([member("a"), member("b")])
      .mockReturnValueOnce(next.promise);
    const vm = mount((row) => row.uid === "bot");
    await vi.advanceTimersByTimeAsync(250);
    await vm.loadMoreSubscribersIfNeed();
    expect(request).toHaveBeenCalledTimes(2);
    next.resolve([member("bot")]);
    await settle();
    expect(vm.subscribers[0].uid).toBe("bot");
  });

  it("retries the failed page without advancing past its members", async () => {
    request
      .mockResolvedValueOnce([member("a"), member("b")])
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([member("c")]);
    const vm = mount();
    await vi.advanceTimersByTimeAsync(250);
    await vm.loadMoreSubscribersIfNeed();
    expect(vm.status).toBe("error");
    expect(vm.subscribers.map((row) => row.uid)).toEqual(["a", "b"]);
    await vm.retry();
    expect(request.mock.calls.map((call) => call[1].page)).toEqual([1, 2, 2]);
    expect(vm.subscribers.map((row) => row.uid)).toEqual(["a", "b", "c"]);
    expect(vm.status).toBe("ready");
  });

  it("releases a failed refresh and retries from its failed page", async () => {
    request.mockResolvedValueOnce([member("a"), member("b")]);
    const vm = mount();
    await vi.advanceTimersByTimeAsync(250);
    request.mockRejectedValueOnce(new Error("offline"));
    vm.refreshCurrentSearch();
    await settle();
    expect(vm.loading).toBe(false);
    expect(vm.status).toBe("error");
    expect(vm.subscribers).toHaveLength(2);
    request.mockResolvedValueOnce([member("fresh")]);
    await vm.retry();
    expect(vm.subscribers[0].uid).toBe("fresh");
  });

  it("coalesces an event burst into one follow-up refresh without starving publication", async () => {
    request.mockResolvedValueOnce([member("a")]);
    const vm = mount();
    await vi.advanceTimersByTimeAsync(250);
    const first = deferred();
    request.mockReturnValueOnce(first.promise).mockResolvedValueOnce([member("latest")]);
    void vm.refreshCurrentSearch();
    void vm.refreshCurrentSearch();
    void vm.refreshCurrentSearch();
    expect(request).toHaveBeenCalledTimes(2);
    first.resolve([member("middle")]);
    await settle();
    expect(request).toHaveBeenCalledTimes(3);
    expect(vm.subscribers.map(row => row.uid)).toEqual(["latest"]);
    expect(vm.status).toBe("ready");
  });

  it("services one queued load-more after a refresh finishes", async () => {
    request.mockResolvedValueOnce([member("a"), member("b")]);
    const vm = mount();
    await vi.advanceTimersByTimeAsync(250);
    const refresh = deferred();
    request.mockReturnValueOnce(refresh.promise).mockResolvedValueOnce([member("c")]);
    void vm.refreshCurrentSearch();
    void vm.loadMoreSubscribersIfNeed();
    refresh.resolve([member("a"), member("b")]);
    await settle();
    expect(request.mock.calls.map(call => call[1].page)).toEqual([1, 1, 2]);
    expect(vm.subscribers.map(row => row.uid)).toEqual(["a", "b", "c"]);
  });

  it("keeps a non-keyword roster across consecutive searches and refresh", async () => {
    request.mockResolvedValueOnce([member("alice"), member("bob")]);
    const search = vi.fn((keyword: string, roster: Subscriber[] = []) =>
      roster.filter((row) => row.uid === keyword)
    );
    const vm = mount(undefined, search);
    await vi.advanceTimersByTimeAsync(250);
    request.mockResolvedValue([]);
    vm.search("alice");
    await settle();
    vm.search("bob");
    expect(vm.subscribers.map((row) => row.uid)).toEqual(["bob"]);
    await settle();
    vm.refreshCurrentSearch();
    await settle();
    expect(
      search.mock.calls.map((call) => call[1]?.map((row) => row.uid))
    ).toEqual([
      ["alice", "bob"],
      ["alice", "bob"],
      ["alice", "bob"],
    ]);
  });

  it("stops at the configured budget, but a new keyword gets a fresh budget", async () => {
    request.mockImplementation((_channel, { keyword }) =>
      Promise.resolve(keyword ? [member("bot")] : [member("a"), member("b")])
    );
    const vm = mount((row) => row.uid === "bot", undefined, 3);
    await vi.advanceTimersByTimeAsync(250);
    expect(request).toHaveBeenCalledTimes(3);
    expect(vm.status).toBe("budget-exhausted");
    vm.search("bot");
    await settle();
    expect(vm.status).toBe("ready");
    expect(vm.subscribers[0].uid).toBe("bot");
  });

  it("replaces a local match before applying fresh server permissions", async () => {
    const cached = member("bot");
    cached.orgData = { bot_owned_by_me: true };
    const fresh = member("bot");
    fresh.orgData = { bot_owned_by_me: false };
    request.mockResolvedValueOnce([cached]).mockResolvedValueOnce([fresh]);
    const vm = mount(
      (row) => row.orgData?.bot_owned_by_me === true,
      (_keyword, roster = []) => roster
    );
    await vi.advanceTimersByTimeAsync(250);
    vm.search("bot");
    expect(vm.subscribers).toEqual([cached]);
    await settle();
    expect(vm.subscribers).toEqual([]);
    expect(vm.status).toBe("ready");
  });

  it("an unmounted request never notifies or mutates the disposed VM", async () => {
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    const vm = mount();
    await vi.advanceTimersByTimeAsync(250);
    const listener = vi.fn();
    vm.addListener(listener);
    vm.didUnMount();
    pending.resolve([member("late")]);
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(vm.subscribers).toEqual([]);
    expect(vm.loading).toBe(false);
  });
});
