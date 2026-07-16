import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("external standalone routes", () => {
  it("opens space management as a standalone document route, not a host app route", () => {
    const source = readRepoFile("packages/dmworkbase/src/Components/NavRail/NavSettingsPanel.tsx");

    expect(source).toContain('window.location.assign("/space")');
    expect(source).not.toContain('WKApp.route.push("/space")');
    expect(source).not.toContain('window.location.href = "/space"');
  });
});
