import React from "react";
import { Channel, Subscriber } from "wukongimjssdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  lookup: vi.fn(),
  changed: undefined as undefined | ((channel: Channel) => void),
}));
vi.mock("../../../App", () => ({
  default: {
    loginInfo: { uid: "owner" },
    shared: { currentSpaceId: "space" },
    dataSource: { channelDataSource: { subscribers: mocks.request } },
  },
}));
vi.mock("../../../Service/ChannelMemberService", () => ({
  ChannelMemberService: { lookup: mocks.lookup },
}));
vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: () => undefined,
  fetchCurrentImChannelInfo: async () => undefined,
  getCurrentImChannelLocallyRemovedSubscriberUids: () => [],
  getCurrentImChannelSubscribers: () => [],
  addCurrentImChannelInfoListener: () => () => {},
  addCurrentImSubscriberChangeListener: (callback: (channel: Channel) => void) => {
    mocks.changed = callback;
    return () => { mocks.changed = undefined; };
  },
}));
vi.mock("../../WKAvatar", () => ({ default: () => null, isBot: () => false }));
vi.mock("../../AiBadge", () => ({ default: () => null }));
vi.mock("../../RealnameVerifiedBadge", () => ({ default: () => null }));
vi.mock("@douyinfe/semi-icons", () => ({ IconSearchStroked: () => null }));
vi.mock("@douyinfe/semi-ui", () => ({ Tag: () => null }));
import { MemberRemovalList } from "../memberRemovalList";

const channel = new Channel("g", 2);
function member(uid: string, owned = false) {
  const row = new Subscriber();
  row.uid = uid;
  row.name = uid;
  row.role = 0;
  row.orgData = { bot_owned_by_me: owned };
  return row;
}
const prefix = Array.from({ length: 50 }, (_, i) => member(`user-${i}`));
function deferred() {
  let resolve!: (rows: Subscriber[]) => void;
  const promise = new Promise<Subscriber[]>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let n = 0; n < 12; n++) await Promise.resolve();
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.request.mockReset();
  mocks.lookup.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("MemberRemovalList with real Provider and real SubscriberListVM", () => {
  it("never reports no-match during debounce or the pending server search", async () => {
    mocks.request.mockResolvedValueOnce([member("alice")]);
    const view = render(<MemberRemovalList channel={channel} viewerUid="owner" viewerRole={1}
      createLocalSearch={() => () => []} />);
    expect(view.queryByTestId("member-removal-loading")).not.toBeNull();
    await advance(250);
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    fireEvent.change(view.getByTestId("member-removal-search"), { target: { value: "bob" } });
    expect(view.queryByTestId("member-removal-loading")).not.toBeNull();
    expect(view.queryByTestId("member-removal-no-match")).toBeNull();
    await advance(300);
    expect(view.queryByTestId("member-removal-no-match")).toBeNull();
    pending.resolve([member("bob")]);
    await advance();
    expect(view.getByRole("checkbox", { name: "bob" })).toBeTruthy();
  });

  it("keeps a cache-external pick across search clear, browse reload and another selection", async () => {
    mocks.request.mockImplementation(async (_channel, { keyword }) =>
      keyword ? [member("rank-450")] : prefix
    );
    const selection = vi.fn();
    const view = render(<MemberRemovalList channel={channel} viewerUid="owner" viewerRole={1}
      onSelectionChange={selection} createLocalSearch={() => () => []} />);
    await advance(250);
    fireEvent.change(view.getByTestId("member-removal-search"), { target: { value: "rank" } });
    await advance(300);
    fireEvent.click(view.getByRole("checkbox", { name: "rank-450" }));
    fireEvent.change(view.getByTestId("member-removal-search"), { target: { value: "" } });
    expect(view.queryByTestId("member-removal-empty")).toBeNull();
    await advance(300);
    fireEvent.click(view.getByRole("checkbox", { name: "user-0" }));
    expect(selection.mock.lastCall?.[0].map((row: Subscriber) => row.uid)).toEqual(["rank-450", "user-0"]);
  });

  it("shows a failed next page alongside existing rows and retries the same page", async () => {
    mocks.request.mockResolvedValueOnce(prefix)
      .mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([member("next")]);
    const view = render(<MemberRemovalList channel={channel} viewerUid="owner" viewerRole={1} />);
    await advance(250);
    fireEvent.click(view.getByTestId("member-removal-load-more"));
    await advance();
    expect(view.queryByTestId("member-removal-error")).not.toBeNull();
    expect(view.getAllByRole("checkbox")).toHaveLength(50);
    fireEvent.click(view.getByTestId("member-removal-retry"));
    await advance();
    expect(mocks.request.mock.calls.map((call) => call[1].page)).toEqual([1, 2, 2]);
    expect(view.getByRole("checkbox", { name: "next" })).toBeTruthy();
  });

  it("an IM refresh during sparse auto-paging resumes loading until the bot is found", async () => {
    const stale = deferred();
    mocks.request.mockResolvedValueOnce(prefix).mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(prefix).mockResolvedValueOnce([member("bot", true)]);
    const view = render(<MemberRemovalList channel={channel} viewerUid="normal" viewerRole={0} />);
    await advance(250);
    act(() => mocks.changed?.(channel));
    await advance();
    stale.resolve(prefix);
    await advance();
    expect(view.queryByTestId("member-removal-loading")).toBeNull();
    expect(view.getByRole("checkbox", { name: "bot" })).toBeTruthy();
  });

  it("removes only explicitly departed selections, retaining failed lookup targets", async () => {
    const alice = member("alice");
    const bob = member("bob");
    mocks.request.mockResolvedValue([alice, bob]);
    mocks.lookup.mockImplementation(async (_channel, uid) => {
      if (uid === "alice") return undefined;
      throw new Error("lookup unavailable");
    });
    const selection = vi.fn();
    const view = render(<MemberRemovalList channel={channel} viewerUid="owner" viewerRole={1}
      onSelectionChange={selection} />);
    await advance(250);
    fireEvent.click(view.getByRole("checkbox", { name: "alice" }));
    fireEvent.click(view.getByRole("checkbox", { name: "bob" }));
    act(() => mocks.changed?.(channel));
    await advance();
    expect(selection.mock.lastCall?.[0].map((row: Subscriber) => row.uid)).toEqual(["bob"]);
    expect(view.getByRole("checkbox", { name: "bob" }).getAttribute("aria-checked")).toBe("true");
  });

  it("still exposes explicit paging after the 200-row render cap", async () => {
    mocks.request.mockImplementation(async (_channel, { page }) =>
      Array.from({ length: 50 }, (_, i) => member(`p${page}-${i}`))
    );
    const view = render(<MemberRemovalList channel={channel} viewerUid="owner" viewerRole={1} />);
    await advance(250);
    for (let n = 0; n < 5; n++) {
      fireEvent.click(view.getByTestId("member-removal-load-more"));
      await advance();
    }
    expect(view.getAllByRole("checkbox")).toHaveLength(200);
    expect(mocks.request.mock.calls.map((call) => call[1].page)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
