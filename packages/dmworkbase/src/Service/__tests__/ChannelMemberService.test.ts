import { Channel } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../APIClient", () => ({ default: { shared: { get } } }));
import { ChannelMemberService } from "../ChannelMemberService";

const channel = new Channel("group/1", 2);
beforeEach(() => { get.mockReset(); });
describe("ChannelMemberService", () => {
  it("preserves the ownership field and sends bounded paging plus cancellation", async () => {
    const signal = new AbortController().signal;
    get.mockResolvedValue([{ uid: "bot", role: 0, bot_owned_by_me: true }]);
    const rows = await ChannelMemberService.page(channel, 3, 100, signal);
    expect(get).toHaveBeenCalledWith("groups/group%2F1/members", {
      param: { page: 3, limit: 100 }, signal,
    });
    expect(rows[0].orgData.bot_owned_by_me).toBe(true);
    expect(rows[0].channel).toBe(channel);
    expect(rows[0].isDeleted).toBe(false);
  });
  it("accepts only explicit exists=false as evidence of departure", async () => {
    get.mockResolvedValueOnce({ exists: false });
    expect(await ChannelMemberService.lookup(channel, "alice")).toBeUndefined();
    for (const data of [undefined, {}, { exists: true }, { exists: "false" }]) {
      get.mockResolvedValueOnce(data);
      await expect(ChannelMemberService.lookup(channel, "alice")).rejects.toThrow();
    }
  });
  it("rejects malformed pages, permissions and mismatched member identities", async () => {
    for (const data of [{}, undefined, [{ uid: "alice" }]]) {
      get.mockResolvedValueOnce(data);
      await expect(ChannelMemberService.page(channel, 1, 100)).rejects.toThrow();
    }
    get.mockResolvedValueOnce({ exists: true, member: { uid: "wrong", role: 0 } });
    await expect(ChannelMemberService.lookup(channel, "alice")).rejects.toThrow();
  });
  it("propagates request failures instead of returning an empty roster", async () => {
    get.mockRejectedValue(new Error("offline"));
    await expect(ChannelMemberService.page(channel, 1, 100)).rejects.toThrow("offline");
    await expect(ChannelMemberService.lookup(channel, "alice")).rejects.toThrow("offline");
  });
});
