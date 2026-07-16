import { beforeEach, describe, expect, it, vi } from "vitest";

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      post: postMock,
    },
  },
}));

import GlobalMessageSearchService from "../GlobalMessageSearchService";

describe("GlobalMessageSearchService", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it("posts the aggregation request with its cancellation signal", async () => {
    const request = {
      keyword: "octo",
      sequence: 7,
      filters: { sender_ids: ["u1"] },
    };
    const controller = new AbortController();
    postMock.mockResolvedValue({ data: { sequence: 7, groups: [] } });

    await GlobalMessageSearchService.searchGroups(request, controller.signal);

    expect(postMock).toHaveBeenCalledWith(
      "messages/_search_global_groups",
      request,
      { signal: controller.signal }
    );
  });
});
