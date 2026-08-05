import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock("../../App", () => ({
  default: {
    apiClient: { get: api.get, put: api.put, delete: api.delete },
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
});

describe("SpaceService.getRoster", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
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

    expect(second).toBe(first);
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
