import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      get: (...args: unknown[]) => mocks.get(...args),
      put: (...args: unknown[]) => mocks.put(...args),
    },
  },
}));

import { getSpaceSetting, updateSpaceSetting } from "../SpaceSettingService";

describe("SpaceSettingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pins reads to the requested space in both query and header", async () => {
    mocks.get.mockResolvedValue({});

    await getSpaceSetting("space-a");

    expect(mocks.get).toHaveBeenCalledWith("/user/space/setting", {
      param: { space_id: "space-a" },
      headers: { "X-Space-Id": "space-a" },
    });
  });

  it("pins updates to the requested space in both query and header", async () => {
    mocks.put.mockResolvedValue(undefined);

    await updateSpaceSetting("space-b", { voice_feedback_on: 1 });

    expect(mocks.put).toHaveBeenCalledWith(
      "/user/space/setting",
      { voice_feedback_on: 1 },
      {
        param: { space_id: "space-b" },
        headers: { "X-Space-Id": "space-b" },
      }
    );
  });
});
