import * as fs from "fs";
import * as path from "path";
import { parseRemoteBool } from "../../../../packages/dmworkbase/src/Utils/remoteConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("drive_on appconfig web integration", () => {
  it.each([
    [0, false],
    ["0", false],
    [undefined, false],
    [1, true],
    ["1", true],
    [true, true],
    ["true", true],
    ["false", false],
  ])("parses appconfig drive_on value %s as driveOn=%s", (value, expected) => {
    expect(parseRemoteBool(value)).toBe(expected);
  });

  it("wires driveOn into WKRemoteConfig from appconfig, defaulting to false", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    // Fail-safe default: hidden until the drive service is deployed and ops flips drive_on.
    expect(source).toContain("driveOn: boolean = false");
    expect(source).toContain('this.driveOn = parseRemoteBool(result["drive_on"])');
    // driveOn must participate in change detection so the NavRail refreshes on toggle.
    expect(source).toContain("previousDriveOn");
    expect(source).toContain("previousDriveOn !== this.driveOn");
    expect(source).toContain("notifyConfigChangeListeners");
  });

  it("gates the Drive NavRail entry on driveOn and refreshes when appconfig arrives", () => {
    const source = readRepoFile("packages/dmworkdrive/src/module.tsx");

    // Menu factory returns the entry only when driveOn is true (else undefined → hidden).
    expect(source).toContain("WKApp.remoteConfig?.driveOn");
    // Subscribe to first load AND later changes, refreshing the NavRail each time.
    expect(source).toContain("rc.addListener(refreshMenus)");
    expect(source).toContain("rc.addConfigChangeListener(refreshMenus)");
    expect(source).toContain("WKApp.menus.refresh?.()");
    // Honor the addListener contract: when appconfig already resolved before init,
    // reflect the current drive_on immediately instead of waiting on a listener.
    expect(source).toContain("rc.requestSuccess");
  });
});
