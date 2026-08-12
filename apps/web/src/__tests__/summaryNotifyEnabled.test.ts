import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { parseRemoteBool } from "../../../../packages/dmworkbase/src/Utils/remoteConfig";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("summary_notify_enabled appconfig integration", () => {
  it.each([
    [0, false],
    ["0", false],
    [undefined, false],
    [1, true],
    ["1", true],
    [true, true],
    ["true", true],
    ["false", false],
  ])("parses appconfig value %s as %s", (value, expected) => {
    expect(parseRemoteBool(value)).toBe(expected);
  });

  it("wires a fail-closed remote flag into the sender", () => {
    const appSource = readRepoFile("packages/dmworkbase/src/App.tsx");
    const detailSource = readRepoFile(
      "packages/dmworksummary/src/pages/SummaryDetailPage.tsx"
    );

    expect(appSource).toContain("summaryNotifyEnabled: boolean = false");
    expect(appSource).toContain(
      'this.summaryNotifyEnabled = parseRemoteBool(result["summary_notify_enabled"])'
    );
    expect(appSource).toContain("previousSummaryNotifyEnabled");
    expect(appSource).toContain(
      "previousSummaryNotifyEnabled !== this.summaryNotifyEnabled"
    );
    expect(detailSource).toContain("WKApp.remoteConfig.summaryNotifyEnabled");
  });
});
