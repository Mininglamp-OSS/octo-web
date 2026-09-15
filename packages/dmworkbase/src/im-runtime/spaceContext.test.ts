import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  shared: { currentSpaceId: "space-a" },
  mittBus: { emit: vi.fn() },
}));
vi.mock("../App", () => ({ default: app }));
import { applyImSpaceContext } from "./spaceContext";

beforeEach(() => {
  app.shared.currentSpaceId = "space-a";
  app.mittBus.emit.mockReset();
});

describe("authoritative IM Space context", () => {
  it("commits the new context before publishing exactly one change", () => {
    const space = { space_id: "space-b", name: "B" };
    app.mittBus.emit.mockImplementation(() => {
      expect(app.shared.currentSpaceId).toBe("space-b");
    });
    expect(applyImSpaceContext(space)).toBe(true);
    expect(app.mittBus.emit).toHaveBeenCalledExactlyOnceWith("space-changed", space);
  });

  it("does not restart data sync for a same-Space metadata update", () => {
    expect(applyImSpaceContext({ space_id: "space-a", name: "renamed" })).toBe(false);
    expect(app.mittBus.emit).not.toHaveBeenCalled();
  });

  it("revokes the old Space even when moving to the no-Space state", () => {
    expect(applyImSpaceContext(undefined)).toBe(true);
    expect(app.shared.currentSpaceId).toBe("");
    expect(app.mittBus.emit).toHaveBeenCalledExactlyOnceWith("space-changed", undefined);
  });
});
