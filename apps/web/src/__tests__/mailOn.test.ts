import * as fs from "fs";
import * as path from "path";
import { parseRemoteBool } from "../../../../packages/dmworkbase/src/Utils/remoteConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("mail_on appconfig web integration", () => {
  it.each([
    [0, false],
    ["0", false],
    [undefined, false],
    [1, true],
    ["1", true],
    [true, true],
    ["true", true],
    ["false", false],
  ])("parses appconfig mail_on value %s as mailOn=%s", (value, expected) => {
    expect(parseRemoteBool(value)).toBe(expected);
  });

  it("wires mailOn into WKRemoteConfig from appconfig, defaulting to false", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    expect(source).toContain("mailOn: boolean = false");
    expect(source).toContain(
      'this.mailOn = parseRemoteBool(result["mail_on"])'
    );
    expect(source).toContain("previousMailOn");
    expect(source).toContain("previousMailOn !== this.mailOn");
    expect(source).toContain("notifyConfigChangeListeners");
  });
});
