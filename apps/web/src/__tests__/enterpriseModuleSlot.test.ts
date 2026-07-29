import fs from "node:fs";
import path from "node:path";

describe("enterprise module slot wiring", () => {
  it("keeps docs in the host but does not statically import closed-source Loop / Personal", () => {
    const entry = fs.readFileSync(path.join(__dirname, "../index.tsx"), "utf-8");

    expect(entry).toMatch(/@octo\/docs/);
    expect(entry).toContain("DocsModule");
    expect(entry).toContain("registerEnterpriseModules");
    expect(entry).not.toMatch(/@octo\/(?:loop|personal)/);
    expect(entry).not.toMatch(/\b(?:LoopModule|PersonalModule)\b/);
  });

  it("reads private full-page capabilities through the virtual enterprise module", () => {
    const layout = fs.readFileSync(path.join(__dirname, "../Layout/index.tsx"), "utf-8");

    expect(layout).toContain("getEnterpriseStandaloneHandlers");
    expect(layout).not.toContain("getEnterpriseStandaloneDocCapability");
    expect(layout).not.toContain("getEnterpriseLoopCapability");
    expect(layout).toMatch(/@octo\/docs/);
    expect(layout).not.toMatch(/@octo\/loop/);
  });
});
