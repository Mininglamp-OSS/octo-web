import { describe, expect, it, vi } from "vitest";
import { submitBotAdmins } from "../botAdmins";

describe("submitBotAdmins", () => {
  it("calls setBotAdmin once per selected uid (N=3) with the exact selected set", async () => {
    const setBotAdmin = vi.fn().mockResolvedValue(undefined);
    const uids = ["bot-a", "bot-b", "bot-c"];

    const result = await submitBotAdmins(uids, setBotAdmin);

    // 调用恰好 3 次
    expect(setBotAdmin).toHaveBeenCalledTimes(3);
    // 参数集合 == 选中集合（顺序无关）
    const calledUids = setBotAdmin.mock.calls.map((c) => c[0]);
    expect(new Set(calledUids)).toEqual(new Set(uids));
    expect(result.succeeded).toEqual(uids);
    expect(result.failed).toEqual([]);
  });

  it("submits remaining uids when one rejects and reports the failed uid(s)", async () => {
    const setBotAdmin = vi.fn((uid: string) =>
      uid === "bot-b"
        ? Promise.reject({ msg: "boom" })
        : Promise.resolve()
    );
    const uids = ["bot-a", "bot-b", "bot-c"];

    const result = await submitBotAdmins(uids, setBotAdmin);

    // 全部 3 个都被尝试提交（第 2 个失败不阻断其余）
    expect(setBotAdmin).toHaveBeenCalledTimes(3);
    expect(result.succeeded).toEqual(["bot-a", "bot-c"]);
    // 失败 uid 被收集（含原因），不静默吞掉
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].uid).toBe("bot-b");
    expect((result.failed[0].reason as any)?.msg).toBe("boom");
    expect(result.failed.map((f) => f.uid)).toContain("bot-b");
  });

  it("collects every failure when all reject", async () => {
    const setBotAdmin = vi.fn().mockRejectedValue({ msg: "down" });
    const uids = ["bot-a", "bot-b"];

    const result = await submitBotAdmins(uids, setBotAdmin);

    expect(setBotAdmin).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual([]);
    expect(result.failed.map((f) => f.uid)).toEqual(["bot-a", "bot-b"]);
  });
});
