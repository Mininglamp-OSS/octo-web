import { describe, expect, it, vi } from "vitest";
import {
  EditorComposePartRegistry,
  chatEditorComposePartRegistry,
} from "../composePartRegistry";

describe("EditorComposePartRegistry", () => {
  it("captures attachment nodes in document order", () => {
    const file = new File(["x"], "image.png", { type: "image/png" });
    const parts = chatEditorComposePartRegistry.capture(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "attachment", attrs: { id: "a", previewUrl: "blob:a" } },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "attachment", attrs: { id: "b" } }],
          },
        ],
      },
      { attachmentFiles: new Map([["a", file]]) },
    );

    expect(parts.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(parts[0]).toMatchObject({
      kind: "attachment",
      file,
      previewUrl: "blob:a",
    });
  });

  it("supports a higher-priority custom node extension", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "fallback",
      canCapture: (node) => node.type === "card",
      capture: (node) => ({
        id: "fallback",
        kind: "fallback",
        extensionId: "fallback",
        node,
      }),
    });
    registry.register({
      id: "location",
      priority: 10,
      canCapture: (node) => node.type === "card",
      capture: (node) => ({
        id: "location",
        kind: "location",
        extensionId: "location",
        node,
      }),
    });

    expect(
      registry.capture(
        { type: "doc", content: [{ type: "card" }] },
        { attachmentFiles: new Map() },
      )[0].kind,
    ).toBe("location");
  });

  it("delegates restore and disposal to the owning extension", () => {
    const registry = new EditorComposePartRegistry();
    const dispose = vi.fn();
    registry.register({
      id: "custom",
      canCapture: () => false,
      capture: () => undefined,
      restore: () => ({ type: "paragraph" }),
      dispose,
    });
    const part = {
      id: "custom-1",
      kind: "custom",
      extensionId: "custom",
      node: { type: "custom" },
    };
    const context = { attachmentFiles: new Map<string, File>() };

    expect(registry.restore(part)).toEqual({ type: "paragraph" });
    registry.dispose(part, context);
    expect(dispose).toHaveBeenCalledWith(part, context);
  });
});
