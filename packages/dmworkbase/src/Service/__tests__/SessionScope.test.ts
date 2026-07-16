import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureSessionSid,
  findReusableStoredSessionSid,
  getSidFromSearch,
  removeSidFromPath,
  removeSidFromSearch,
  setSessionSid,
  stripSessionSidFromUrl,
} from "../SessionScope";

describe("SessionScope", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setSessionSid("");
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("extracts sid from query strings", () => {
    expect(getSidFromSearch("?sid=abc")).toBe("abc");
    expect(getSidFromSearch("?doc=d1&sid=abc")).toBe("abc");
    expect(getSidFromSearch("?doc=d1")).toBe("");
  });

  it("removes only sid from query strings", () => {
    expect(removeSidFromSearch("?sid=abc")).toBe("");
    expect(removeSidFromSearch("?doc=d1&sid=abc&space=s1")).toBe("?doc=d1&space=s1");
  });

  it("absorbs a URL sid into sessionStorage and keeps using it after the URL is clean", () => {
    window.history.replaceState({}, "", "/appbot?sid=abc");

    expect(ensureSessionSid()).toBe("abc");
    expect(stripSessionSidFromUrl()).toBe(true);
    expect(window.location.pathname + window.location.search).toBe("/appbot");
    expect(ensureSessionSid()).toBe("abc");
  });

  it("creates a per-tab sid when neither URL nor sessionStorage has one", () => {
    const sid = ensureSessionSid();

    expect(sid).toMatch(/^[a-z0-9]{1,6}$/);
    expect(ensureSessionSid()).toBe(sid);
  });

  it("reuses one stored login bucket for clean links opened in a new tab", () => {
    localStorage.setItem("tokenabc", "token-value");
    localStorage.setItem("uidabc", "u1");

    expect(ensureSessionSid()).toBe("abc");
  });

  it("reuses same-identity buckets but refuses ambiguous different identities", () => {
    localStorage.setItem("tokenabc", "token-a");
    localStorage.setItem("uidabc", "u1");
    localStorage.setItem("tokendef", "token-b");
    localStorage.setItem("uiddef", "u1");

    expect(findReusableStoredSessionSid(localStorage)).toBe("abc");

    localStorage.setItem("uiddef", "u2");
    expect(findReusableStoredSessionSid(localStorage)).toBe("");
  });

  it("removes sid from relative return paths while preserving other query params", () => {
    expect(removeSidFromPath("/d/d_abc?sid=fresh6&sp=space-1")).toBe("/d/d_abc?sp=space-1");
    expect(removeSidFromPath("/s/TN_1?sp=space-1&sid=fresh6#x")).toBe("/s/TN_1?sp=space-1#x");
  });
});
