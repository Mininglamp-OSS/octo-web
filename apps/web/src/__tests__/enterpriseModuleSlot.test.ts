import fs from "node:fs";
import path from "node:path";

describe("enterprise module slot wiring", () => {
  it("does not statically import removed enterprise feature packages", () => {
    const entry = fs.readFileSync(path.join(__dirname, "../index.tsx"), "utf-8");

    expect(entry).toContain("registerEnterpriseModules");
    expect(entry).not.toMatch(/@octo\/(?:docs|loop|personal|drive)/);
    expect(entry).not.toMatch(/\b(?:DocsModule|LoopModule|PersonalModule|DriveModule)\b/);
  });

  it("reads private full-page capabilities through the virtual enterprise module", () => {
    const layout = fs.readFileSync(path.join(__dirname, "../Layout/index.tsx"), "utf-8");

    expect(layout).toContain("getEnterpriseStandaloneHandlers");
    expect(layout).not.toContain("getEnterpriseStandaloneDocCapability");
    expect(layout).not.toContain("getEnterpriseLoopCapability");
    expect(layout).not.toMatch(/@octo\/(?:docs|loop|drive)/);
  });
});
