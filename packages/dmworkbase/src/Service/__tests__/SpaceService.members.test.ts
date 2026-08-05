import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock("../../App", () => ({
  default: {
    apiClient: { get: api.get, put: api.put, post: api.post, delete: api.delete },
    shared: {},
    loginInfo: {},
  },
}));

import { SpaceService, type SpaceMember } from "../SpaceService";

function member(uid: string): SpaceMember {
  return {
    uid,
    name: uid,
    avatar: "",
    role: 3,
    robot: 0,
    created_at: "",
  };
}

/** 造一页刚好等于 pageLimit 的返回，迫使分页循环继续。 */
function fullPage(size: number): SpaceMember[] {
  return Array.from({ length: size }, (_, i) => member(`u${i}`));
}

describe("SpaceService member pagination", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
    SpaceService.shared.invalidateRoster();
  });

  it("omits the request config when no signal is given", async () => {
    api.get.mockResolvedValue([]);

    await SpaceService.shared.getMembers("space-1", 2, 25);

    expect(api.get).toHaveBeenCalledWith("space/space-1/members?page=2&limit=25");
  });

  it("forwards the cancellation signal to member requests", async () => {
    const controller = new AbortController();
    api.get.mockResolvedValue([]);

    await SpaceService.shared.getMembers("space-1", 2, 25, controller.signal);

    expect(api.get).toHaveBeenCalledWith(
      "space/space-1/members?page=2&limit=25",
      { signal: controller.signal }
    );
  });

  it("stops paginating after the signal is aborted", async () => {
    const controller = new AbortController();
    api.get.mockImplementation(async () => {
      controller.abort();
      return [member("u1"), member("u2")];
    });

    await expect(
      SpaceService.shared.getAllMembers("space-1", 2, 50, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("keeps paginating until a short page arrives", async () => {
    api.get
      .mockResolvedValueOnce(fullPage(2))
      .mockResolvedValueOnce([member("last")]);

    const all = await SpaceService.shared.getAllMembers("space-1", 2, 50);

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(all).toHaveLength(3);
  });

  it("returns an empty list without a request when spaceId is empty", async () => {
    await expect(SpaceService.shared.getAllMembers("")).resolves.toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("translates an in-flight cancellation into AbortError", async () => {
    const controller = new AbortController();
    // 复刻 APIClient 的真实行为：axios 取消抛 ERR_CANCELED，而
    // normalizeApiError（apiError.ts:96-109）只归类 ECONNABORTED / ERR_NETWORK，
    // 于是取消被包装成通用「未知错误」。调用方必须仍看到 AbortError。
    api.get.mockImplementation(async () => {
      controller.abort();
      throw { code: "err.shared.unknown", message: "unknown error", normalized: {} };
    });

    await expect(
      SpaceService.shared.getMembers("space-1", 1, 10, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("surfaces AbortError through getAllMembers on an in-flight cancellation", async () => {
    const controller = new AbortController();
    api.get.mockImplementation(async () => {
      controller.abort();
      throw { code: "err.shared.unknown", message: "unknown error" };
    });

    await expect(
      SpaceService.shared.getAllMembers("space-1", 2, 50, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("does not mask a genuine failure as a cancellation", async () => {
    const controller = new AbortController();
    api.get.mockRejectedValue(new Error("boom"));

    // signal 未触发 → 原始错误必须原样抛出，不能被翻译成 AbortError。
    await expect(
      SpaceService.shared.getMembers("space-1", 1, 10, controller.signal)
    ).rejects.toThrow("boom");
  });
});

describe("SpaceService.getRoster", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
    SpaceService.shared.invalidateRoster();
  });

  it("uses a page limit above the known 5760-member space", async () => {
    api.get.mockResolvedValue([member("u1")]);

    await SpaceService.shared.getRoster("space-1");

    // getAllMembers 的默认 100×50 上限是 5000，会截断 5760 人的空间。
    expect(api.get).toHaveBeenCalledWith("space/space-1/members?page=1&limit=10000");
  });

  it("serves repeat calls from cache within the ttl", async () => {
    api.get.mockResolvedValue([member("u1")]);

    const first = await SpaceService.shared.getRoster("space-1");
    const second = await SpaceService.shared.getRoster("space-1");

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("does not let one caller mutate the cached roster array", async () => {
    api.get.mockResolvedValue([member("u1"), member("u2")]);

    const first = await SpaceService.shared.getRoster("space-1");
    first.reverse();
    first.push(member("injected"));

    await expect(SpaceService.shared.getRoster("space-1")).resolves.toEqual([
      member("u1"),
      member("u2"),
    ]);
    expect(SpaceService.shared.peekRoster("space-1")).toEqual([
      member("u1"),
      member("u2"),
    ]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent callers into a single request", async () => {
    api.get.mockResolvedValue([member("u1")]);

    await Promise.all([
      SpaceService.shared.getRoster("space-1"),
      SpaceService.shared.getRoster("space-1"),
      SpaceService.shared.getRoster("space-1"),
    ]);

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("caches per space so switching space refetches", async () => {
    api.get.mockResolvedValue([member("u1")]);

    await SpaceService.shared.getRoster("space-1");
    await SpaceService.shared.getRoster("space-2");

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenNthCalledWith(1, "space/space-1/members?page=1&limit=10000");
    expect(api.get).toHaveBeenNthCalledWith(2, "space/space-2/members?page=1&limit=10000");
  });

  it("refetches after removeMembers invalidates the roster", async () => {
    api.get.mockResolvedValue([member("u1")]);
    api.delete.mockResolvedValue(undefined);

    await SpaceService.shared.getRoster("space-1");
    await SpaceService.shared.removeMembers("space-1", ["u1"]);
    await SpaceService.shared.getRoster("space-1");

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("refetches after updateMemberRole invalidates the roster", async () => {
    api.get.mockResolvedValue([member("u1")]);
    api.put.mockResolvedValue(undefined);

    await SpaceService.shared.getRoster("space-1");
    await SpaceService.shared.updateMemberRole("space-1", "u1", 2);
    await SpaceService.shared.getRoster("space-1");

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("refetches after disbandSpace invalidates the roster", async () => {
    api.get.mockResolvedValue([member("u1")]);
    api.delete.mockResolvedValue(undefined);

    await SpaceService.shared.getRoster("space-1");
    await SpaceService.shared.disbandSpace("space-1");
    await SpaceService.shared.getRoster("space-1");

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("refetches after leaveSpace invalidates the roster", async () => {
    api.get.mockResolvedValue([member("u1")]);
    api.post.mockResolvedValue(undefined);

    await SpaceService.shared.getRoster("space-1");
    // 自己退出后名册里不该还有自己——与 removeMembers 对称。
    await SpaceService.shared.leaveSpace("space-1");
    await SpaceService.shared.getRoster("space-1");

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed roster load", async () => {
    api.get.mockRejectedValueOnce(new Error("boom"));

    await expect(SpaceService.shared.getRoster("space-1")).rejects.toThrow("boom");
    expect(SpaceService.shared.peekRoster("space-1")).toBeUndefined();

    api.get.mockResolvedValue([member("u1")]);
    await expect(SpaceService.shared.getRoster("space-1")).resolves.toHaveLength(1);
  });

  it("bypasses the cache when maxAgeMs is 0", async () => {
    api.get.mockResolvedValue([member("u1")]);

    await SpaceService.shared.getRoster("space-1");
    await SpaceService.shared.getRoster("space-1", { maxAgeMs: 0 });

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list without a request when spaceId is empty", async () => {
    await expect(SpaceService.shared.getRoster("")).resolves.toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });
});
