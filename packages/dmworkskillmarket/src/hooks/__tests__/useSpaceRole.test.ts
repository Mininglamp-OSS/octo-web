import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SpaceService, WKApp, type Space } from "@octo/base";
import { isSpaceOwnerRole, isSpaceReviewerRole, useSpaceRole } from "../useSpaceRole";

function space(role: number, spaceId = "space-123"): Space {
  return {
    space_id: spaceId,
    name: "Dev Space",
    description: "",
    logo: "",
    member_count: 3,
    max_users: 0,
    role,
    created_at: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  WKApp.shared.currentSpaceId = "space-123";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isSpaceReviewerRole", () => {
  it("treats admin (1) and owner (2) as reviewers", () => {
    expect(isSpaceReviewerRole(1)).toBe(true);
    expect(isSpaceReviewerRole(2)).toBe(true);
  });

  it("does NOT treat member (0) as a reviewer", () => {
    expect(isSpaceReviewerRole(0)).toBe(false);
  });

  it("rejects an unresolved or out-of-range role rather than failing open", () => {
    expect(isSpaceReviewerRole(undefined)).toBe(false);
    expect(isSpaceReviewerRole(-1)).toBe(false);
    expect(isSpaceReviewerRole(3)).toBe(false);
  });

  it("only treats role 2 as the Space owner", () => {
    expect(isSpaceOwnerRole(2)).toBe(true);
    expect(isSpaceOwnerRole(1)).toBe(false);
    expect(isSpaceOwnerRole(0)).toBe(false);
  });
});

describe("useSpaceRole", () => {
  it("resolves the current Space's role from getMySpaces", async () => {
    vi.spyOn(SpaceService.shared, "getMySpaces").mockResolvedValue([
      space(0, "other-space"),
      space(1, "space-123"),
    ]);

    const { result } = renderHook(() => useSpaceRole());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.role).toBe(1);
    expect(result.current.isReviewer).toBe(true);
  });

  it("is not a reviewer for a plain member (role 0)", async () => {
    vi.spyOn(SpaceService.shared, "getMySpaces").mockResolvedValue([space(0)]);

    const { result } = renderHook(() => useSpaceRole());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.role).toBe(0);
    expect(result.current.isReviewer).toBe(false);
  });

  it("fails closed when the Space is not in the caller's list", async () => {
    vi.spyOn(SpaceService.shared, "getMySpaces").mockResolvedValue([
      space(1, "somewhere-else"),
    ]);

    const { result } = renderHook(() => useSpaceRole());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.role).toBeUndefined();
    expect(result.current.isReviewer).toBe(false);
  });

  it("fails closed when the probe rejects", async () => {
    vi.spyOn(SpaceService.shared, "getMySpaces").mockRejectedValue(
      new Error("offline")
    );

    const { result } = renderHook(() => useSpaceRole());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isReviewer).toBe(false);
  });

  it("does not probe at all without a current Space", async () => {
    WKApp.shared.currentSpaceId = "";
    const probe = vi
      .spyOn(SpaceService.shared, "getMySpaces")
      .mockResolvedValue([]);

    const { result } = renderHook(() => useSpaceRole());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(probe).not.toHaveBeenCalled();
    expect(result.current.isReviewer).toBe(false);
  });

  it("adopts the role carried by the space-changed payload", async () => {
    vi.spyOn(SpaceService.shared, "getMySpaces").mockResolvedValue([space(1)]);

    const { result } = renderHook(() => useSpaceRole());
    await waitFor(() => expect(result.current.isReviewer).toBe(true));

    act(() => {
      WKApp.mittBus.emit("space-changed", space(0, "space-999"));
    });

    await waitFor(() => expect(result.current.role).toBe(0));
    expect(result.current.isReviewer).toBe(false);
  });

  it("re-probes when space-changed arrives without a payload", async () => {
    const probe = vi
      .spyOn(SpaceService.shared, "getMySpaces")
      .mockResolvedValue([space(0)]);

    const { result } = renderHook(() => useSpaceRole());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(probe).toHaveBeenCalledTimes(1);

    probe.mockResolvedValue([space(1)]);
    act(() => {
      WKApp.mittBus.emit("space-changed");
    });

    await waitFor(() => expect(result.current.isReviewer).toBe(true));
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("does not let the pre-switch probe overwrite the role from a space-changed payload", async () => {
    // Regression: the initial getMySpaces() closes over the OLD spaceId. When
    // the payload fast-path sets the new role synchronously, the older
    // promise's .then must NOT be allowed to land — it would resolve the role
    // for a Space the user already left, granting or revoking the reviewer tab
    // at random. Per-attempt generation, not just an unmount flag.
    let resolveInitial: ((spaces: Space[]) => void) | undefined;
    vi.spyOn(SpaceService.shared, "getMySpaces").mockImplementation(
      () =>
        new Promise<Space[]>((resolve) => {
          resolveInitial = resolve;
        })
    );

    const { result } = renderHook(() => useSpaceRole());
    expect(result.current.loading).toBe(true);

    // Switch to a Space where the caller is a plain member, via the payload
    // fast-path, while the first probe is still in flight.
    WKApp.shared.currentSpaceId = "space-999";
    act(() => {
      WKApp.mittBus.emit("space-changed", space(0, "space-999"));
    });
    expect(result.current.role).toBe(0);
    expect(result.current.isReviewer).toBe(false);

    // The stale probe now resolves, claiming reviewer on the OLD space id.
    await act(async () => {
      resolveInitial?.([space(1, "space-123")]);
      await Promise.resolve();
    });

    expect(result.current.role).toBe(0);
    expect(result.current.isReviewer).toBe(false);
    expect(result.current.loading).toBe(false);
  });
});
