import * as fs from "fs";
import * as path from "path";
import { parseRemoteBool } from "../../../../packages/dmworkbase/src/Utils/remoteConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("expert_market_on appconfig web integration", () => {
  it.each([
    [0, false],
    ["0", false],
    [undefined, false],
    [1, true],
    ["1", true],
    [true, true],
    ["true", true],
    ["false", false],
  ])(
    "parses appconfig expert_market_on value %s as expertMarketOn=%s",
    (value, expected) => {
      expect(parseRemoteBool(value)).toBe(expected);
    }
  );

  it("wires expertMarketOn into WKRemoteConfig from appconfig, defaulting to false", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    // Fail-safe default: the expert market backend (octo-marketplace expert-v1)
    // may not be deployed; the tab stays hidden until ops flips expert_market_on.
    expect(source).toContain("expertMarketOn: boolean = false");
    expect(source).toContain(
      'this.expertMarketOn = parseRemoteBool(result["expert_market_on"])'
    );
    // expertMarketOn must participate in change detection so the sidebar/pane
    // reconcile on toggle.
    expect(source).toContain("previousExpertMarketOn");
    expect(source).toContain("previousExpertMarketOn !== this.expertMarketOn");
    expect(source).toContain("notifyConfigChangeListeners");
  });

  it("gates the experts route on expertMarketOn with the MCP fallback", () => {
    const source = readRepoFile("packages/dmworkmcp/src/module.tsx");

    // Deep link to /mcp-market/experts degrades to the MCP landing page while
    // the flag is off — never mounts a tab whose first request 404s.
    expect(source).toContain('"/mcp-market/experts"');
    expect(source).toContain(
      "WKApp.remoteConfig?.expertMarketOn ? <ExpertMarketListPage /> : <McpMarketListPage />"
    );
  });

  it("gates the sidebar entry and reconciles the mounted pane when the flag flips", () => {
    const source = readRepoFile(
      "packages/dmworkmcp/src/components/MarketSidebar.tsx"
    );

    // The experts entry is filtered from the item list while the flag is off…
    expect(source).toContain("WKApp.remoteConfig?.expertMarketOn");
    expect(source).toContain('MARKET_ITEMS.filter((item) => item.id !== "experts")');
    // …and a flag flip must reconcile the RIGHT PANE, not just the sidebar:
    // appconfig resolves after mount, and an ops kill-switch must take effect
    // without waiting for the user to click a tab.
    expect(source).toContain("rc.addListener(reconcile)");
    expect(source).toContain("rc.addConfigChangeListener(reconcile)");
    expect(source).toContain("this.replaceRightPane(item)");
    // Honor the addListener contract when appconfig resolved before mount.
    expect(source).toContain("rc.requestSuccess");
  });
});
