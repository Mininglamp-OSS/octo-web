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

  it("keeps Drive registration delegated to enterprise modules", () => {
    const source = readRepoFile("apps/web/src/index.tsx");

    // The open-source host only exposes the appconfig bridge. The Drive NavRail
    // entry itself is supplied by the enterprise module slot.
    expect(source).toContain("registerEnterpriseModules");
    expect(source).not.toContain("new DriveModule()");
  });
});

describe("drive_search_on appconfig web integration", () => {
  it("wires driveSearchOn into WKRemoteConfig from appconfig, defaulting to false", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    // Second flag of the staged rollout: the drive search tab shows only when
    // BOTH drive_on and drive_search_on are true. Fail-safe default keeps it
    // hidden until ops flips drive_search_on after multi-type search ships.
    expect(source).toContain("driveSearchOn: boolean = false");
    expect(source).toContain(
      'this.driveSearchOn = parseRemoteBool(result["drive_search_on"])'
    );
    // driveSearchOn must participate in change detection so the search UI
    // refreshes when ops toggles the flag.
    expect(source).toContain("previousDriveSearchOn");
    expect(source).toContain("previousDriveSearchOn !== this.driveSearchOn");
    expect(source).toContain("notifyConfigChangeListeners");
  });
});
