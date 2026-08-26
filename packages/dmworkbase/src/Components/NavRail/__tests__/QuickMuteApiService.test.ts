import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../Service/APIClient", () => ({
  default: { shared: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } },
}));

import APIClient from "../../../Service/APIClient";
import { QuickMuteApiService } from "../QuickMuteStore";

const api = APIClient.shared as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => vi.clearAllMocks());

describe("QuickMuteApiService", () => {
  it("normalizes the server state and marks expired pauses inactive", async () => {
    api.get.mockResolvedValueOnce({
      paused: true,
      paused_until: new Date(Date.now() - 1_000).toISOString(),
      revision: 7,
      server_time: new Date().toISOString(),
    });

    await expect(new QuickMuteApiService().getState()).resolves.toMatchObject({
      active: false,
      revision: 7,
      scope: "sound-and-popup",
      serverTime: expect.any(String),
    });
    expect(api.get).toHaveBeenCalledWith("/user/notification-pause");
  });

  it("sets a 30 minute pause through the account endpoint", async () => {
    api.put.mockResolvedValueOnce({
      paused: true,
      paused_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      server_time: new Date().toISOString(),
      revision: 8,
    });

    await expect(new QuickMuteApiService().setMute({ duration: "30m" })).resolves.toMatchObject({
      active: true,
      revision: 8,
    });
    const [path, body] = api.put.mock.calls[0];
    expect(path).toBe("/user/notification-pause");
    expect(body).toEqual({ duration: "30m" });
  });

  it("rejects a custom pause that is not in the future", async () => {
    await expect(new QuickMuteApiService().setMute({ duration: "custom", endAt: Date.now() - 1 })).rejects.toThrow(
      "A future notification pause time is required",
    );
    expect(api.put).not.toHaveBeenCalled();
  });

  it("sends manual mode without calculating a client deadline", async () => {
    api.put.mockResolvedValueOnce({ paused: true, mode: "manual", paused_until: null, revision: 8, server_time: new Date().toISOString() });
    await expect(new QuickMuteApiService().setMute({ duration: "manual" })).resolves.toMatchObject({ active: true, mode: "manual", endAt: undefined });
    expect(api.put).toHaveBeenCalledWith("/user/notification-pause", { mode: "manual" });
  });

  it("resumes through DELETE and normalizes the response", async () => {
    api.delete.mockResolvedValueOnce({ paused: false, revision: 9 });

    await expect(new QuickMuteApiService().resume()).resolves.toMatchObject({
      active: false,
      revision: 9,
    });
    expect(api.delete).toHaveBeenCalledWith("/user/notification-pause");
  });
});
