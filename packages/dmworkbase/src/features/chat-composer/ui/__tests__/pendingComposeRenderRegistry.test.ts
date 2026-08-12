import { describe, expect, it } from "vitest";
import { PendingComposeRenderRegistry } from "../pendingComposeRenderRegistry";

describe("PendingComposeRenderRegistry", () => {
  it("selects the highest-priority renderer that can handle an item", () => {
    const registry = new PendingComposeRenderRegistry<
      { kind: string },
      string
    >();
    registry.register({
      id: "fallback",
      canRender: () => true,
      render: () => "fallback",
    });
    registry.register({
      id: "extension",
      priority: 10,
      canRender: (item) => item.kind === "location",
      render: () => "location",
    });

    expect(
      registry.render({ kind: "location" }, {
        sendingLabel: "sending",
        renderAttachment: () => null,
      }),
    ).toBe("location");
    expect(
      registry.render({ kind: "text" }, {
        sendingLabel: "sending",
        renderAttachment: () => null,
      }),
    ).toBe("fallback");
  });

  it("rejects duplicate renderer IDs and supports removal", () => {
    const registry = new PendingComposeRenderRegistry<unknown, unknown>();
    registry.register({
      id: "default",
      canRender: () => true,
      render: () => null,
    });

    expect(() =>
      registry.register({
        id: "default",
        canRender: () => true,
        render: () => null,
      }),
    ).toThrow("already registered");
    expect(registry.unregister("default")).toBe(true);
    expect(registry.unregister("default")).toBe(false);
  });

  it("does not let a stale disposer unregister a replacement renderer", () => {
    const registry = new PendingComposeRenderRegistry<unknown, unknown>();
    const disposeFirst = registry.register({
      id: "default",
      canRender: () => true,
      render: () => "first",
    });
    registry.unregister("default");
    registry.register({
      id: "default",
      canRender: () => true,
      render: () => "replacement",
    });

    expect(disposeFirst()).toBe(false);
    expect(
      registry.render({}, {
        sendingLabel: "sending",
        renderAttachment: () => null,
      }),
    ).toBe("replacement");
  });
});
