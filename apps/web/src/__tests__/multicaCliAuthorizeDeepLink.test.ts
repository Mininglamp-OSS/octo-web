import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingMulticaCliAuthorizeSearch,
  isMulticaCliAuthorizePath,
  resolveMulticaCliAuthorizeSearch,
  visibleMulticaCliAuthorizeSearch,
} from "../../../../packages/dmloop/src/cliAuthorizeSession";

describe("Multica CLI authorize deep link", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("accepts the canonical route with or without a trailing slash", () => {
    expect(isMulticaCliAuthorizePath("/loop/cli-authorize")).toBe(true);
    expect(isMulticaCliAuthorizePath("/loop/cli-authorize/")).toBe(true);
    expect(isMulticaCliAuthorizePath("/loop/multica")).toBe(false);
  });

  it("keeps callback parameters after RouteManager replaces the query with sid", () => {
    const original =
      "?cli_callback=http%3A%2F%2Flocalhost%3A57270%2Fcallback&cli_state=state-1";

    expect(
      resolveMulticaCliAuthorizeSearch(
        "/loop/cli-authorize",
        original,
        sessionStorage
      )
    ).toBe(original);

    expect(
      resolveMulticaCliAuthorizeSearch(
        "/loop/cli-authorize/",
        "?sid=llg60f",
        sessionStorage
      )
    ).toBe(original);
  });

  it("clears the pending callback after redirecting to the CLI", () => {
    resolveMulticaCliAuthorizeSearch(
      "/loop/cli-authorize",
      "?cli_callback=http%3A%2F%2Flocalhost%3A57270%2Fcallback&cli_state=x",
      sessionStorage
    );

    clearPendingMulticaCliAuthorizeSearch(sessionStorage);

    expect(
      resolveMulticaCliAuthorizeSearch(
        "/loop/cli-authorize",
        "?sid=next",
        sessionStorage
      )
    ).toBe("?sid=next");
  });

  it("keeps the existing sid when callback parameters are hidden", () => {
    expect(
      visibleMulticaCliAuthorizeSearch(
        "?sid=5asghu&cli_callback=http%3A%2F%2Flocalhost%3A52652%2Fcallback&cli_state=state"
      )
    ).toBe("?sid=5asghu");
  });

  it("wires the full-page route before the regular authenticated shell", () => {
    const layout = fs.readFileSync(
      path.join(__dirname, "../Layout/index.tsx"),
      "utf-8"
    );
    const cliRoute = layout.indexOf("isMulticaCliAuthorizePath(");
    const provider = layout.search(/return\s*(?:\(\s*)?<Provider/);

    expect(cliRoute).toBeGreaterThan(-1);
    expect(provider).toBeGreaterThan(-1);
    expect(cliRoute).toBeLessThan(provider);
    expect(layout).toContain("recoverOctoSessionFromStorage(true)");
    expect(layout).toMatch(
      /WKApp\.route\.get\(\s*MULTICA_CLI_AUTHORIZE_PATH\s*\)/
    );
  });
});
