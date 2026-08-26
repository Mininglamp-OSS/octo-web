import { describe, expect, it } from "vitest";
import {
  authorizationPhase,
  authorizationPollIntervalMs,
  isAuthorizationExpired,
} from "./authorizationFlow";

describe("Agent Mail authorization flow", () => {
  it("does not treat human approval as a completed mailbox connection", () => {
    expect(authorizationPhase("pending")).toBe("approval");
    expect(authorizationPhase("approved")).toBe("connecting");
    expect(authorizationPhase("exchanged")).toBe("connected");
    expect(authorizationPhase("denied")).toBe("failed");
    expect(authorizationPhase("expired")).toBe("failed");
  });
});

describe("isAuthorizationExpired", () => {
  it("fails closed for expired or malformed deadlines", () => {
    expect(
      isAuthorizationExpired(
        { expiresAt: "2026-08-12T00:00:00Z" },
        Date.parse("2026-08-12T00:00:01Z")
      )
    ).toBe(true);
    expect(isAuthorizationExpired({ expiresAt: "invalid" }, 0)).toBe(true);
    expect(
      isAuthorizationExpired(
        { expiresAt: "2026-08-12T00:00:02Z" },
        Date.parse("2026-08-12T00:00:01Z")
      )
    ).toBe(false);
  });
});

describe("authorizationPollIntervalMs", () => {
  it("uses the interval returned by the authorization service", () => {
    expect(authorizationPollIntervalMs({ pollIntervalSeconds: 3 })).toBe(3_000);
  });

  it("keeps backward-compatible and safe bounds", () => {
    expect(authorizationPollIntervalMs()).toBe(3_000);
    expect(authorizationPollIntervalMs({ pollIntervalSeconds: 0.1 })).toBe(
      1_000
    );
    expect(authorizationPollIntervalMs({ pollIntervalSeconds: 600 })).toBe(
      60_000
    );
  });
});
