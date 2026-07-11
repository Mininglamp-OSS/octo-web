import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingLoopCliAuthorizeSearch,
  isLoopCliAuthorizePath,
  resolveLoopCliAuthorizeSearch,
  visibleLoopCliAuthorizeSearch,
} from "../../../../packages/dmloop/src/cliAuthorizeSession";

describe("Loop CLI authorize deep link", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("accepts the canonical route with or without a trailing slash", () => {
    expect(isLoopCliAuthorizePath("/loop/cli-authorize")).toBe(true);
    expect(isLoopCliAuthorizePath("/loop/cli-authorize/")).toBe(true);
    expect(isLoopCliAuthorizePath("/loop/not-authorize")).toBe(false);
  });

  it("keeps callback parameters after RouteManager replaces the query with sid", () => {
    const original =
      "?cli_callback=http%3A%2F%2Flocalhost%3A57270%2Fcallback&cli_state=state-1";

    expect(
      resolveLoopCliAuthorizeSearch(
        "/loop/cli-authorize",
        original,
        sessionStorage
      )
    ).toBe(original);

    expect(
      resolveLoopCliAuthorizeSearch(
        "/loop/cli-authorize/",
        "?sid=llg60f",
        sessionStorage
      )
    ).toBe(original);
  });

  it("clears the pending callback after redirecting to the CLI", () => {
    resolveLoopCliAuthorizeSearch(
      "/loop/cli-authorize",
      "?cli_callback=http%3A%2F%2Flocalhost%3A57270%2Fcallback&cli_state=x",
      sessionStorage
    );

    clearPendingLoopCliAuthorizeSearch(sessionStorage);

    expect(
      resolveLoopCliAuthorizeSearch(
        "/loop/cli-authorize",
        "?sid=next",
        sessionStorage
      )
    ).toBe("?sid=next");
  });

  it("keeps the existing sid when callback parameters are hidden", () => {
    expect(
      visibleLoopCliAuthorizeSearch(
        "?sid=5asghu&cli_callback=http%3A%2F%2Flocalhost%3A52652%2Fcallback&cli_state=state"
      )
    ).toBe("?sid=5asghu");
  });

  it("wires the full-page route before the regular authenticated shell", () => {
    const layout = fs.readFileSync(
      path.join(__dirname, "../Layout/index.tsx"),
      "utf-8"
    );
    const cliRoute = layout.indexOf("isLoopCliAuthorizePath(");
    const provider = layout.search(/return\s*(?:\(\s*)?<Provider/);

    expect(cliRoute).toBeGreaterThan(-1);
    expect(provider).toBeGreaterThan(-1);
    expect(cliRoute).toBeLessThan(provider);
    expect(layout).toContain("recoverOctoSessionFromStorage(true)");
    expect(layout).toMatch(
      /WKApp\.route\.get\(\s*LOOP_CLI_AUTHORIZE_PATH\s*\)/
    );
  });
});
