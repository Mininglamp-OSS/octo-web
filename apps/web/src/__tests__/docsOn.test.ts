import * as fs from "fs";
import * as path from "path";
import { parseRemoteBool } from "../../../../packages/dmworkbase/src/Utils/remoteConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("docs_on appconfig web integration", () => {
  it.each([
    [0, false],
    ["0", false],
    [undefined, false],
    [1, true],
    ["1", true],
    [true, true],
    ["true", true],
    ["false", false],
  ])("parses appconfig docs_on value %s as docsOn=%s", (value, expected) => {
    expect(parseRemoteBool(value)).toBe(expected);
  });

  it("wires docsOn into WKRemoteConfig from appconfig, defaulting to false", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    // Fail-safe default: hidden until docs-backend is deployed and ops flips docs_on.
    expect(source).toContain("docsOn: boolean = false");
    expect(source).toContain('this.docsOn = parseRemoteBool(result["docs_on"])');
    // docsOn must participate in change detection so the NavRail refreshes on toggle.
    expect(source).toContain("previousDocsOn");
    expect(source).toContain("previousDocsOn !== this.docsOn");
    expect(source).toContain("notifyConfigChangeListeners");
  });

  it("gates the Docs NavRail entry on docsOn and refreshes when appconfig arrives", () => {
    const source = readRepoFile("packages/docs/src/module.tsx");

    // Menu factory returns the entry only when docsOn is true (else undefined → hidden).
    expect(source).toContain("wk.remoteConfig?.docsOn");
    // Subscribe to first load AND later changes, refreshing the NavRail each time.
    expect(source).toContain("wk.remoteConfig?.addListener(refreshMenus)");
    expect(source).toContain(
      "wk.remoteConfig?.addConfigChangeListener(refreshMenus)"
    );
    expect(source).toContain("wk.menus.refresh?.()");
  });
});
