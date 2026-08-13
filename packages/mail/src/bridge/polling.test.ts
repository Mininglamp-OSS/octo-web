import { describe, expect, it } from "vitest";
import { isTransientMailPollError } from "./polling";

describe("Agent Mail polling errors", () => {
  it("retries network, rate-limit, and server failures", () => {
    expect(isTransientMailPollError(new Error("network"))).toBe(true);
    expect(isTransientMailPollError({ status: 429 })).toBe(true);
    expect(isTransientMailPollError({ normalized: { httpStatus: 502 } })).toBe(
      true
    );
  });

  it("stops on terminal client responses", () => {
    expect(isTransientMailPollError({ status: 400 })).toBe(false);
    expect(isTransientMailPollError({ normalized: { httpStatus: 404 } })).toBe(
      false
    );
  });
});
