import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSummaryWorkbenchSessionScope } from "./useSummaryWorkbenchSessionScope";

const mocks = vi.hoisted(() => ({ loginUid: "fallback-user" }));

vi.mock("@octo/base/src/App", () => ({
  default: {
    loginInfo: {
      get uid() {
        return mocks.loginUid;
      },
    },
  },
}));

describe("useSummaryWorkbenchSessionScope", () => {
  it("tracks a live uid even when the messaging object stays stable", () => {
    let uid = "user-a";
    const messaging = {
      getCurrentUser: () => ({ uid }),
    };
    const { result, rerender } = renderHook(() =>
      useSummaryWorkbenchSessionScope({ spaceId: "space-a", messaging })
    );
    expect(result.current.userId).toBe("user-a");

    uid = "user-b";
    rerender();

    expect(result.current.userId).toBe("user-b");
  });

  it("falls back to the host uid when messaging cannot resolve a user", () => {
    mocks.loginUid = "fallback-user";
    const messaging = {
      getCurrentUser: () => {
        throw new Error("host not ready");
      },
    };
    const { result } = renderHook(() =>
      useSummaryWorkbenchSessionScope({ spaceId: "space-a", messaging })
    );

    expect(result.current.userId).toBe("fallback-user");
  });
});
