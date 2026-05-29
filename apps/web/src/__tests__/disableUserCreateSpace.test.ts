import * as fs from "fs";
import * as path from "path";
import { parseRemoteBool } from "../../../../packages/dmworkbase/src/Utils/remoteConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("disable_user_create_space web integration", () => {
  it.each([
    [0, false],
    ["0", false],
    [undefined, false],
    [1, true],
    ["1", true],
    [true, true],
    ["true", true],
    ["false", false],
  ])("parses appconfig value %s as disabled=%s", (value, expected) => {
    expect(parseRemoteBool(value)).toBe(expected);
  });

  it("reads disable_user_create_space from appconfig and refreshes on foreground", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    expect(source).toContain("disableUserCreateSpace: boolean = false");
    expect(source).toContain('result["disable_user_create_space"]');
    expect(source).toContain("parseRemoteBool");
    expect(source).toContain("addConfigChangeListener");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain('window.addEventListener("focus"');
  });

  it("hides the SpaceList create-space action behind remote config", () => {
    const source = readRepoFile(
      "packages/dmworkbase/src/Components/SpaceList/index.tsx"
    );

    expect(source).toContain("WKApp.remoteConfig.disableUserCreateSpace");
    expect(source).toContain("addConfigChangeListener");
    expect(source).toMatch(/\{canCreateSpace\s*&&\s*\(/);
    expect(source).toContain('variant="create"');
  });

  it("hides the no-space create-team button and modal behind remote config", () => {
    const source = readRepoFile("apps/web/src/Components/SpaceGate/index.tsx");

    expect(source).toContain("WKApp.remoteConfig.disableUserCreateSpace");
    expect(source).toContain("addConfigChangeListener");
    expect(source).toMatch(/\{canCreateSpace\s*&&\s*\(/);
    expect(source).toMatch(/visible=\{canCreateSpace\s*&&\s*showCreate\}/);
  });

  it("shows create-space in the no-space join page only when enabled", () => {
    const source = readRepoFile("apps/web/src/Components/JoinSpacePage/index.tsx");

    expect(source).toContain("SpaceCreate");
    expect(source).toContain("WKApp.remoteConfig.disableUserCreateSpace");
    expect(source).toContain("addConfigChangeListener");
    expect(source).toMatch(/\{canCreateSpace\s*&&\s*\(/);
    expect(source).toMatch(/visible=\{canCreateSpace\s*&&\s*showCreate\}/);
  });

  it("shows create-space in the nav space switcher only when enabled", () => {
    const switcherSource = readRepoFile(
      "packages/dmworkbase/src/Components/NavRail/NavSpaceSwitcher.tsx"
    );
    const mainSource = readRepoFile("apps/web/src/Pages/Main/index.tsx");

    expect(switcherSource).toContain("WKApp.remoteConfig.disableUserCreateSpace");
    expect(switcherSource).toContain("addConfigChangeListener");
    expect(switcherSource).toContain("onCreateSpace");
    expect(switcherSource).toContain("IconCreateSpace");
    expect(mainSource).toContain("showCreateSpace");
    expect(mainSource).toContain("<SpaceCreate");
  });

  it("guards the chat create-space modal against stale triggers", () => {
    const source = readRepoFile("packages/dmworkbase/src/Pages/Chat/index.tsx");

    expect(source).toContain("WKApp.remoteConfig.disableUserCreateSpace");
    expect(source).toContain("addConfigChangeListener");
    expect(source).toMatch(
      /!\s*WKApp\.remoteConfig\.disableUserCreateSpace\s*&&\s*\(/
    );
    expect(source).toContain("<SpaceCreate");
  });
});
