import { afterEach, describe, expect, it } from "vitest";
import { isDocumentFocusScene, isDocumentScenePath } from "./documentScene";

describe("isDocumentScenePath", () => {
  it("matches standalone doc paths", () => {
    expect(isDocumentScenePath("/d/abc123")).toBe(true);
    expect(isDocumentScenePath("/d/Doc_-123")).toBe(true);
    // trailing slash is normalized away (parity with normalizeRoutePath)
    expect(isDocumentScenePath("/d/abc123/")).toBe(true);
  });

  it("matches standalone ppt doc paths", () => {
    expect(isDocumentScenePath("/ppt/d/abc123")).toBe(true);
    expect(isDocumentScenePath("/ppt/d/abc123/")).toBe(true);
  });

  it("rejects non-doc paths", () => {
    expect(isDocumentScenePath("/")).toBe(false);
    expect(isDocumentScenePath("/d")).toBe(false);
    expect(isDocumentScenePath("/d/")).toBe(false);
    expect(isDocumentScenePath("/dashboard")).toBe(false);
    expect(isDocumentScenePath("/docs")).toBe(false);
    expect(isDocumentScenePath("/chat")).toBe(false);
    expect(isDocumentScenePath("/s/task123")).toBe(false);
    // nested / malformed doc ids must not be treated as the doc scene
    expect(isDocumentScenePath("/d/a/b")).toBe(false);
    expect(isDocumentScenePath("/d/../etc")).toBe(false);
    expect(isDocumentScenePath("/ppt/d")).toBe(false);
  });

  it("ignores query and hash by matching pathname only", () => {
    // callers pass window.location.pathname (no query/hash), so a raw path
    // carrying them is not a doc scene — documents the expected input.
    expect(isDocumentScenePath("/d/abc123?sp=x")).toBe(false);
  });

  it("handles non-string / empty input defensively", () => {
    expect(isDocumentScenePath("")).toBe(false);
    expect(isDocumentScenePath(undefined as unknown as string)).toBe(false);
    expect(isDocumentScenePath(null as unknown as string)).toBe(false);
  });
});

describe("isDocumentFocusScene", () => {
  const originalPathname = window.location.pathname;

  const setPathname = (pathname: string) => {
    window.history.replaceState({}, "", pathname);
  };

  afterEach(() => {
    window.history.replaceState({}, "", originalPathname);
  });

  it("returns true on a standalone doc page", () => {
    setPathname("/d/abc123");
    expect(isDocumentFocusScene()).toBe(true);
  });

  it("returns false on the chat / app shell", () => {
    setPathname("/");
    expect(isDocumentFocusScene()).toBe(false);
    setPathname("/chat");
    expect(isDocumentFocusScene()).toBe(false);
  });
});
