import { Channel, Subscriber } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { page, lookup } = vi.hoisted(() => ({ page: vi.fn(), lookup: vi.fn() }));
vi.mock("../../../Service/ChannelMemberService", () => ({
  ChannelMemberService: { page, lookup },
}));
import { findRemovableGroupMember, newMemberEntryCursor, readSelectedMembers } from "../memberRemovalRead";

const channel = new Channel("group", 2);
function member(uid: string, owned: unknown = false, role = 0) {
  const row = new Subscriber();
  row.uid = uid;
  row.role = role;
  row.orgData = { bot_owned_by_me: owned };
  return row;
}
const prefix = Array.from({ length: 100 }, (_, index) => member(`user-${index}`));
beforeEach(() => { page.mockReset(); lookup.mockReset(); });

describe("server-backed removal entry", () => {
  it("finds the owner's bot beyond cached pages and stops immediately on a match", async () => {
    page.mockResolvedValueOnce(prefix).mockResolvedValueOnce(prefix.map(row => member(`second-${row.uid}`)))
      .mockResolvedValueOnce([member("bot", true)]);
    expect(await findRemovableGroupMember(channel, "me", 0, new AbortController().signal)).toBe("found");
    expect(page.mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
  });
  it("does not infer absence until the last page, or widen role/ownership checks", async () => {
    page.mockResolvedValueOnce(prefix).mockResolvedValueOnce([
      member("truthy", 1), member("admin", true, 2), member("me", true),
    ]);
    expect(await findRemovableGroupMember(channel, "me", 0, new AbortController().signal)).toBe("none");
    expect(page).toHaveBeenCalledTimes(2);
  });
  it("stops after cancellation without treating a late match as current", async () => {
    const controller = new AbortController();
    page.mockImplementationOnce(async () => {
      controller.abort();
      return [member("bot", true)];
    });
    expect(await findRemovableGroupMember(channel, "me", 0, controller.signal)).toBe("partial");
    expect(page).toHaveBeenCalledOnce();
  });
  it("keeps a failed scan distinguishable from no matching bot", async () => {
    page.mockRejectedValueOnce(new Error("offline"));
    await expect(findRemovableGroupMember(channel, "me", 0, new AbortController().signal))
      .rejects.toThrow("offline");
  });
  it("stops after five full pages and resumes from page six on explicit continuation", async () => {
    page.mockImplementation(async (_channel, n) =>
      Array.from({ length: 100 }, (_, i) => member(`${n}-${i}`, n === 6 && i === 30))
    );
    const cursor = newMemberEntryCursor();
    const signal = new AbortController().signal;
    expect(await findRemovableGroupMember(channel, "me", 0, signal, cursor)).toBe("partial");
    expect(page).toHaveBeenCalledTimes(5);
    expect(cursor.nextPage).toBe(6);
    expect(await findRemovableGroupMember(channel, "me", 0, signal, cursor)).toBe("found");
    expect(page.mock.calls.map(call => call[1])).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("terminates a server repeating full pages instead of looping forever", async () => {
    page.mockResolvedValue(prefix);
    await expect(findRemovableGroupMember(channel, "me", 0, new AbortController().signal))
      .rejects.toThrow("Repeated");
    expect(page).toHaveBeenCalledTimes(2);
  });
  it("retries the failed page without losing its continuation cursor", async () => {
    page.mockResolvedValueOnce(prefix).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([member("bot", true)]);
    const cursor = newMemberEntryCursor();
    const signal = new AbortController().signal;
    await expect(findRemovableGroupMember(channel, "me", 0, signal, cursor)).rejects.toThrow();
    expect(cursor.nextPage).toBe(2);
    expect(await findRemovableGroupMember(channel, "me", 0, signal, cursor)).toBe("found");
    expect(page.mock.calls.map(call => call[1])).toEqual([1, 2, 2]);
  });
});

describe("selection evidence", () => {
  it("separates explicit departure, present rows and uncertain failures", async () => {
    lookup.mockImplementation(async (_channel, uid) => {
      if (uid === "gone") return undefined;
      if (uid === "unknown") throw new Error("offline");
      return member(uid);
    });
    const result = await readSelectedMembers(channel, ["gone", "present", "unknown", "gone"]);
    expect(result.absent).toEqual(["gone"]);
    expect(result.present.map((row) => row.uid)).toEqual(["present"]);
    expect(result.unknown).toEqual(["unknown"]);
    expect(lookup).toHaveBeenCalledTimes(3);
  });
  it("bounds concurrent lookups to four", async () => {
    let running = 0;
    let maximum = 0;
    lookup.mockImplementation(async (_channel, uid) => {
      maximum = Math.max(maximum, ++running);
      await Promise.resolve();
      running--;
      return member(uid);
    });
    await readSelectedMembers(channel, Array.from({ length: 20 }, (_, i) => `${i}`));
    expect(maximum).toBe(4);
  });
  it("retries an unknown lookup once and reports final progress", async () => {
    const progress = vi.fn();
    lookup.mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(member("alice"));
    const result = await readSelectedMembers(channel, ["alice"], undefined, {
      retryUnknown: true,
      onProgress: progress,
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.present.map(row => row.uid)).toEqual(["alice"]);
    expect(result.unknown).toEqual([]);
    expect(progress).toHaveBeenCalledWith(1, 1);
  });
  it("does not issue more lookups after cancellation and keeps unfinished targets unknown", async () => {
    const controller = new AbortController();
    lookup.mockImplementationOnce(async () => {
      controller.abort();
      return member("first");
    });
    const result = await readSelectedMembers(channel, ["first", "second", "third"], controller.signal);
    expect(lookup).toHaveBeenCalledOnce();
    expect(result.present).toEqual([]);
    expect(result.unknown).toEqual(["first", "second", "third"]);
  });
});
