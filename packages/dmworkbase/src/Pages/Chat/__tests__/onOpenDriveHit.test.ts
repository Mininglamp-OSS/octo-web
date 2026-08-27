import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DriveSearchHit } from "../../../Service/SearchTypes";
import {
  buildDriveFileHitUrl,
  openDriveFileHit,
  type OpenedTab,
} from "../openDriveFileHit";

// Tests the REAL production routing (openDriveFileHit / buildDriveFileHitUrl),
// not a mirror — so folder-skip, URL shape, opener=null, and popup handling
// cannot drift from what Chat's handler actually calls. Chat/index.tsx only
// wires window.open + Toast into these functions (verified by the source guard).

function baseHit(overrides: Partial<DriveSearchHit> = {}): DriveSearchHit {
  return {
    file_id: 1234,
    space_id: "space-9",
    space_name: "共享空间",
    parent_id: 0,
    path: ["设计稿"],
    name: "spec.pdf",
    type: "blob",
    ext: "pdf",
    size: 2048,
    owner_uid: "u1",
    owner_name: "Alex",
    updater_uid: "u1",
    updater_name: "Alex",
    created_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-24T09:30:00.000Z",
    ...overrides,
  };
}

describe("buildDriveFileHitUrl", () => {
  it("file hit: /drive/f/<id> with name, size and spaceId in the query", () => {
    const u = new URL(buildDriveFileHitUrl(baseHit())!, "https://x.example.com");
    expect(u.pathname).toBe("/drive/f/1234");
    expect(u.searchParams.get("name")).toBe("spec.pdf");
    expect(u.searchParams.get("size")).toBe("2048");
    expect(u.searchParams.get("spaceId")).toBe("space-9");
  });

  it("folder hit: returns null (no preview URL)", () => {
    expect(buildDriveFileHitUrl(baseHit({ type: "folder", name: "设计稿" }))).toBeNull();
  });

  it("missing size: leaves the size param empty rather than 'undefined'", () => {
    const u = new URL(
      buildDriveFileHitUrl(baseHit({ size: undefined }))!,
      "https://x.example.com"
    );
    expect(u.searchParams.get("size")).toBe("");
  });
});

describe("openDriveFileHit", () => {
  let tab: OpenedTab;
  let open: ReturnType<typeof vi.fn>;
  let onBlocked: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tab = { opener: {}, location: { href: "about:blank" } };
    open = vi.fn(() => tab);
    onBlocked = vi.fn();
  });
  afterEach(() => vi.clearAllMocks());

  it("file hit: opens about:blank, clears opener, then navigates to the preview URL", () => {
    openDriveFileHit(baseHit(), { open, onBlocked });
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(tab.opener).toBeNull();
    const u = new URL(tab.location.href, "https://x.example.com");
    expect(u.pathname).toBe("/drive/f/1234");
    expect(u.searchParams.get("spaceId")).toBe("space-9");
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("folder hit: never opens a tab (client-side backstop)", () => {
    openDriveFileHit(baseHit({ type: "folder", name: "设计稿" }), { open, onBlocked });
    expect(open).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("popup blocked: calls onBlocked and does not navigate", () => {
    open.mockReturnValueOnce(null);
    openDriveFileHit(baseHit(), { open, onBlocked });
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it("frozen opener setter: swallows and still navigates", () => {
    Object.defineProperty(tab, "opener", {
      get: () => ({}),
      set: () => {
        throw new Error("frozen");
      },
    });
    expect(() => openDriveFileHit(baseHit(), { open, onBlocked })).not.toThrow();
    expect(tab.location.href).toContain("/drive/f/1234");
  });
});

describe("Chat handler delegates to openDriveFileHit (source guard)", () => {
  // Behavior above tests the real function; this only guards that the handler
  // keeps calling it (no re-inlined copy that could drift) and wires the popup
  // warning in, without importing the heavy Chat class into vitest.
  const src = fs.readFileSync(path.resolve(__dirname, "../index.tsx"), "utf8");

  it("onOpenDriveHit calls openDriveFileHit with a popup-blocked Toast", () => {
    const start = src.indexOf("onOpenDriveHit={(hit)");
    expect(start, "onOpenDriveHit handler should exist").toBeGreaterThan(-1);
    const block = src.slice(start, start + 600);
    expect(block).toMatch(/openDriveFileHit\(hit,/);
    expect(block).toMatch(/popupBlocked/);
    expect(src).toMatch(/import \{ openDriveFileHit \} from "\.\/openDriveFileHit"/);
  });
});
