import { Channel, Subscriber } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { page, lookup } = vi.hoisted(() => ({ page: vi.fn(), lookup: vi.fn() }));
vi.mock("../../../Service/ChannelMemberService", () => ({
  ChannelMemberService: { page, lookup },
}));
import { findRemovableGroupMember, readSelectedMembers } from "../memberRemovalRead";

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
    page.mockResolvedValueOnce(prefix).mockResolvedValueOnce(prefix)
      .mockResolvedValueOnce([member("bot", true)]);
    expect(await findRemovableGroupMember(channel, "me", 0, new AbortController().signal)).toBe(true);
    expect(page.mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
  });
  it("does not infer absence until the last page, or widen role/ownership checks", async () => {
    page.mockResolvedValueOnce(prefix).mockResolvedValueOnce([
      member("truthy", 1), member("admin", true, 2), member("me", true),
    ]);
    expect(await findRemovableGroupMember(channel, "me", 0, new AbortController().signal)).toBe(false);
    expect(page).toHaveBeenCalledTimes(2);
  });
  it("stops after cancellation without treating a late match as current", async () => {
    const controller = new AbortController();
    page.mockImplementationOnce(async () => {
      controller.abort();
      return [member("bot", true)];
    });
    expect(await findRemovableGroupMember(channel, "me", 0, controller.signal)).toBe(false);
    expect(page).toHaveBeenCalledOnce();
  });
  it("keeps a failed scan distinguishable from no matching bot", async () => {
    page.mockRejectedValueOnce(new Error("offline"));
    await expect(findRemovableGroupMember(channel, "me", 0, new AbortController().signal))
      .rejects.toThrow("offline");
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
});
