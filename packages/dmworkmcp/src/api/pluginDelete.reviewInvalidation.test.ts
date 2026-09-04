import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// Both api modules build their own axios instance at import time, so mock the
// factory (same pattern as expertService.visibility.test / mcpService.connector.test).
const mock = vi.hoisted(() => ({
  instance: {
    interceptors: {
      request: { use: () => undefined },
      response: { use: () => undefined },
    },
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("axios", () => ({
  default: {
    create: () => mock.instance,
    isCancel: () => false,
  },
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    apiClient: { config: { apiURL: "/api/v1/" } },
    loginInfo: { token: "tok" },
    shared: { currentSpaceId: "sp" },
  },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { deleteMcp } from "./mcpService";
import { deleteExpert, deleteSquad } from "./expertService";
import { subscribeReviewsChanged } from "@dmwork/skillmarket/src/api/reviewSignal";

/**
 * Deleting a plugin settles its pending review request in the same transaction
 * server-side (octo-marketplace `cancelPendingReviewFor`, reason "plugin
 * deleted"), because a request whose plugin is gone can be neither seen nor
 * decided by anyone. The Space's pending count therefore really does drop on a
 * delete — which is why every client-side read of it, the 组织发布管理 sidebar
 * badge above all, is stale until it re-reads.
 *
 * @dmwork/skillmarket's `deleteSkill` has been wrapped for exactly this since
 * the invalidation moved to the endpoints. The three deletes below hit the SAME
 * `POST /plugins/delete` from this package's own api modules, so they went
 * unwrapped and their callers refreshed nothing: deleting a connector or an
 * expert with an open request left the badge counting a plugin that no longer
 * existed.
 *
 * These assertions are about the WIRING, not about any one caller — that is the
 * point of putting it on the endpoint. A new delete surface (a bulk action, a
 * detail drawer, a keyboard shortcut) inherits it without knowing it exists.
 */
describe("plugin deletes invalidate the review reads", () => {
  let seen: number;
  let unsubscribe: () => void;

  beforeEach(() => {
    seen = 0;
    unsubscribe = subscribeReviewsChanged(() => {
      seen += 1;
    });
    mock.instance.post.mockReset();
  });

  afterEach(() => unsubscribe());

  it("connector 删除 announces the change", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });
    await deleteMcp("connector-1");
    expect(seen).toBe(1);
  });

  it("专家 删除 announces the change", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });
    await deleteExpert("expert-1");
    expect(seen).toBe(1);
  });

  it("专家团 删除 announces the change", async () => {
    mock.instance.post.mockResolvedValue({ data: { data: {} } });
    await deleteSquad("squad-1");
    expect(seen).toBe(1);
  });

  /**
   * A REFUSED delete announces too, for the same reason the review decisions do:
   * the interesting refusal is the one that means our copy is already out of
   * date (somebody else removed it, the row moved out from under us), and a
   * failure is then the strongest evidence the badge is stale. Re-reading after
   * a refusal costs one request; not re-reading costs a wrong number that
   * survives until a reload.
   */
  it("announces even when the delete is refused", async () => {
    mock.instance.post.mockRejectedValue(new Error("boom"));
    await expect(deleteMcp("connector-1")).rejects.toThrow();
    expect(seen).toBe(1);
  });
});
