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

  it("doc hit with ref_id: routes to the /d/<ref_id> standalone reader, not /drive/f/*", () => {
    const u = new URL(
      buildDriveFileHitUrl(baseHit({ type: "doc", ref_id: "doc-abc", name: "设计文档" }))!,
      "https://x.example.com"
    );
    expect(u.pathname).toBe("/d/doc-abc");
    expect(u.pathname).not.toContain("/drive/f/");
  });

  it("doc hit without ref_id: returns null (no reader link, must not fall through to /drive/f/*)", () => {
    expect(buildDriveFileHitUrl(baseHit({ type: "doc", ref_id: undefined }))).toBeNull();
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
  let onUnavailable: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tab = { opener: {}, location: { href: "about:blank" } };
    open = vi.fn(() => tab);
    onBlocked = vi.fn();
    onUnavailable = vi.fn();
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

  it("folder hit: never opens a tab and surfaces the unavailable feedback", () => {
    openDriveFileHit(baseHit({ type: "folder", name: "设计稿" }), {
      open,
      onBlocked,
      onUnavailable,
    });
    expect(open).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("doc hit with ref_id: navigates to /d/<ref_id> (docs reader), not the blob preview", () => {
    openDriveFileHit(baseHit({ type: "doc", ref_id: "doc-abc", name: "设计文档" }), {
      open,
      onBlocked,
    });
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    const u = new URL(tab.location.href, "https://x.example.com");
    expect(u.pathname).toBe("/d/doc-abc");
    expect(tab.location.href).not.toContain("/drive/f/");
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("doc hit without ref_id: warns, never opens a tab, and surfaces the unavailable feedback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openDriveFileHit(baseHit({ type: "doc", ref_id: undefined }), {
      open,
      onBlocked,
      onUnavailable,
    });
    expect(open).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("doc hit missing ref_id"),
      expect.anything()
    );
    warn.mockRestore();
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

  it("desktop shell: opens through the Electron links bridge, not window.open", async () => {
    const openExternal = vi.fn(async () => ({ ok: true }));
    const toAbsoluteUrl = vi.fn((u: string) => `https://api.example.com${u}`);
    openDriveFileHit(baseHit(), {
      open,
      onBlocked,
      getLinksBridge: () => ({ openExternal }),
      toAbsoluteUrl,
    });
    // Electron's setWindowOpenHandler denies the web about:blank open, so the
    // web path must be skipped entirely on desktop.
    expect(open).not.toHaveBeenCalled();
    expect(toAbsoluteUrl).toHaveBeenCalledWith("/drive/f/1234?name=spec.pdf&size=2048&spaceId=space-9");
    expect(openExternal).toHaveBeenCalledWith(
      "https://api.example.com/drive/f/1234?name=spec.pdf&size=2048&spaceId=space-9"
    );
    await Promise.resolve();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("desktop shell: a rejected bridge open surfaces the blocked warning", async () => {
    const openExternal = vi.fn(async () => ({ ok: false, reason: "denied" }));
    openDriveFileHit(baseHit(), {
      open,
      onBlocked,
      getLinksBridge: () => ({ openExternal }),
      toAbsoluteUrl: (u) => `https://api.example.com${u}`,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(1);
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
