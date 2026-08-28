import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the App singleton so we can flip remoteConfig flags; the VM only reads
// WKApp.remoteConfig in the tabList getter under test.
const mockState = vi.hoisted(() => ({
  remoteConfig: {
    docsOn: false as boolean,
    docsSearchOn: false as boolean,
    driveOn: false as boolean,
    driveSearchOn: false as boolean,
  },
}));

vi.mock("../../../App", () => ({
  default: { remoteConfig: mockState.remoteConfig },
}));

// Identity translator so tab itemKeys are what we assert on (labels are keys).
vi.mock("../../../i18n", () => ({
  t: (k: string) => k,
}));

import GlobalSearchVM from "../GlobalSearchVM";

beforeEach(() => {
  mockState.remoteConfig.docsOn = false;
  mockState.remoteConfig.docsSearchOn = false;
  mockState.remoteConfig.driveOn = false;
  mockState.remoteConfig.driveSearchOn = false;
});

describe("GlobalSearchVM tabList — drive tab gating", () => {
  const keys = (vm: GlobalSearchVM) => vm.tabList.map((t) => t.itemKey);

  it("omits the drive tab when both drive flags are off", () => {
    const vm = new GlobalSearchVM();
    expect(keys(vm)).not.toContain("drive");
  });

  it("omits the drive tab when driveOn is true but driveSearchOn is false", () => {
    mockState.remoteConfig.driveOn = true;
    mockState.remoteConfig.driveSearchOn = false;
    expect(keys(new GlobalSearchVM())).not.toContain("drive");
  });

  it("omits the drive tab when driveSearchOn is true but driveOn is false", () => {
    mockState.remoteConfig.driveOn = false;
    mockState.remoteConfig.driveSearchOn = true;
    expect(keys(new GlobalSearchVM())).not.toContain("drive");
  });

  it("appends the drive tab only when driveOn AND driveSearchOn are true", () => {
    mockState.remoteConfig.driveOn = true;
    mockState.remoteConfig.driveSearchOn = true;
    const vm = new GlobalSearchVM();
    const list = keys(vm);
    expect(list).toContain("drive");
    // drive is peer to (and ordered after) the base tabs — last when docs is off.
    expect(list[list.length - 1]).toBe("drive");
  });

  it("gates independently of the docs flags", () => {
    mockState.remoteConfig.driveOn = true;
    mockState.remoteConfig.driveSearchOn = true;
    mockState.remoteConfig.docsOn = true;
    mockState.remoteConfig.docsSearchOn = true;
    const list = keys(new GlobalSearchVM());
    expect(list).toContain("docs");
    expect(list).toContain("drive");
  });
});
