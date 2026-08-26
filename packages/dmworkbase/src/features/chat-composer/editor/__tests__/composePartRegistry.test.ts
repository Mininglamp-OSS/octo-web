import { describe, expect, it, vi } from "vitest";
import {
  createDefaultEditorComposePartRegistry,
  EditorComposePartRegistry,
} from "../composePartRegistry";

describe("EditorComposePartRegistry", () => {
  it("captures attachment nodes in document order", () => {
    const fileA = new File(["a"], "a.png", { type: "image/png" });
    const fileB = new File(["b"], "b.png", { type: "image/png" });
    const registry = createDefaultEditorComposePartRegistry();
    const parts = registry.capture(
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
      {
        attachmentFiles: new Map([
          ["a", fileA],
          ["b", fileB],
        ]),
      },
    );

    expect(parts.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(parts[0]).toMatchObject({
      kind: "attachment",
      file: fileA,
      previewUrl: "blob:a",
    });
  });

  it("skips attachment nodes without a backing File", () => {
    const registry = createDefaultEditorComposePartRegistry();

    expect(
      registry.capture(
        {
          type: "doc",
          content: [{ type: "attachment", attrs: { id: "orphan" } }],
        },
        { attachmentFiles: new Map() },
      ),
    ).toEqual([]);
  });

  it("deduplicates repeated built-in attachment nodes by resource id", () => {
    const registry = createDefaultEditorComposePartRegistry();
    const file = new File(["x"], "image.png", { type: "image/png" });

    const parts = registry.capture(
      {
        type: "doc",
        content: [
          { type: "attachment", attrs: { id: "same" } },
          { type: "attachment", attrs: { id: "same" } },
        ],
      },
      { attachmentFiles: new Map([["same", file]]) },
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ id: "same", file });
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

  it("maps attachment parts to the existing media settlement model", () => {
    const file = new File(["x"], "image.png", { type: "image/png" });
    const registry = createDefaultEditorComposePartRegistry();
    const [part] = registry.capture(
      {
        type: "doc",
        content: [{ type: "attachment", attrs: { id: "a" } }],
      },
      { attachmentFiles: new Map([["a", file]]) },
    );

    expect(registry.toSendBlock(part)).toEqual({
      type: "image",
      id: "a",
      file,
    });
  });

  it("rejects duplicate part IDs before settlement maps overwrite them", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "custom",
      canCapture: (node) => node.type === "custom",
      capture: (node) => ({
        id: "duplicate",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
    });

    expect(() =>
      registry.capture(
        {
          type: "doc",
          content: [{ type: "custom" }, { type: "custom" }],
        },
        { attachmentFiles: new Map() },
      ),
    ).toThrow("duplicate editor compose part id");
  });

  it("fails closed when a captured part has no send settlement adapter", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "custom",
      canCapture: () => true,
      capture: (node) => ({
        id: "custom-1",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
    });
    const [part] = registry.capture(
      {
        type: "doc",
        content: [{ type: "custom", attrs: { id: "custom-1" } }],
      },
      { attachmentFiles: new Map() },
    );

    expect(() => registry.assertSettlementSupported(part)).toThrow(
      "cannot participate in send settlement",
    );
  });

  it("fails closed when a custom sendable part has no recovery policy", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "custom",
      canCapture: () => true,
      capture: (node) => ({
        id: "custom-1",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
      toSendBlock: (part) => ({
        type: "extension:custom",
        id: part.id,
        payload: {},
      }),
    });
    const [part] = registry.capture(
      {
        type: "doc",
        content: [{ type: "custom", attrs: { id: "custom-1" } }],
      },
      { attachmentFiles: new Map() },
    );

    expect(() => registry.assertSettlementSupported(part)).toThrow(
      "cannot participate in send settlement",
    );
  });

  it("rejects a send block that changes its captured part id", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "custom",
      recovery: "snapshot",
      canCapture: () => true,
      capture: (node) => ({
        id: "custom-1",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
      toSendBlock: () => ({
        type: "extension:custom",
        id: "different-id",
        payload: {},
      }),
    });
    const [part] = registry.capture(
      {
        type: "doc",
        content: [{ type: "custom", attrs: { id: "custom-1" } }],
      },
      { attachmentFiles: new Map() },
    );

    expect(() => registry.toSendBlock(part)).toThrow(
      "send block id mismatch",
    );
  });

  it("requires snapshot recovery ids to come from node attrs", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "custom",
      recovery: "snapshot",
      canCapture: () => true,
      capture: (node) => ({
        id: "generated-at-capture",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
      toSendBlock: (part) => ({
        type: "extension:custom",
        id: part.id,
        payload: {},
      }),
    });

    expect(() =>
      registry.capture(
        { type: "doc", content: [{ type: "custom" }] },
        { attachmentFiles: new Map() },
      ),
    ).toThrow("must match node attrs.id");
  });

  it("rejects snapshot capture that mutates the source node id", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "custom",
      recovery: "snapshot",
      canCapture: () => true,
      capture: (node) => {
        if (node.attrs) node.attrs.id = "mutated-id";
        return {
          id: "mutated-id",
          kind: "custom",
          extensionId: "custom",
          node,
        };
      },
      toSendBlock: (part) => ({
        type: "extension:custom",
        id: part.id,
        payload: {},
      }),
    });

    expect(() =>
      registry.capture(
        {
          type: "doc",
          content: [{ type: "custom", attrs: { id: "source-id" } }],
        },
        { attachmentFiles: new Map() },
      ),
    ).toThrow("must match node attrs.id");
  });

  it("rejects malformed send blocks during preflight", () => {
    const registry = new EditorComposePartRegistry();
    registry.register({
      id: "custom",
      recovery: "snapshot",
      canCapture: () => true,
      capture: (node) => ({
        id: "custom-1",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
      toSendBlock: () =>
        ({
          type: "extension:",
          id: "custom-1",
          payload: {},
        }) as never,
    });
    const [part] = registry.capture(
      {
        type: "doc",
        content: [{ type: "custom", attrs: { id: "custom-1" } }],
      },
      { attachmentFiles: new Map() },
    );

    expect(() => registry.toSendBlock(part)).toThrow("invalid send block");
  });

  it("does not let a stale disposer unregister a replacement extension", () => {
    const registry = new EditorComposePartRegistry();
    const disposeFirst = registry.register({
      id: "custom",
      canCapture: () => false,
      capture: () => undefined,
    });
    registry.unregister("custom");
    registry.register({
      id: "custom",
      canCapture: () => false,
      capture: () => undefined,
    });

    expect(disposeFirst()).toBe(false);
    expect(() =>
      registry.register({
        id: "custom",
        canCapture: () => false,
        capture: () => undefined,
      }),
    ).toThrow("already registered");
  });

  it("keeps captured lifecycle hooks alive after unregister", () => {
    const registry = new EditorComposePartRegistry();
    const dispose = vi.fn();
    const unregister = registry.register({
      id: "custom",
      canCapture: (node) => node.type === "custom",
      capture: (node) => ({
        id: "custom-1",
        kind: "custom",
        extensionId: "custom",
        node,
      }),
      restore: () => ({ type: "paragraph" }),
      dispose,
    });
    const [part] = registry.capture(
      { type: "doc", content: [{ type: "custom" }] },
      { attachmentFiles: new Map() },
    );
    unregister();

    expect(registry.restore(part)).toEqual({ type: "paragraph" });
    registry.dispose(part, { attachmentFiles: new Map() });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not silently restore or dispose after the owner is unregistered", () => {
    const registry = new EditorComposePartRegistry();
    const unregister = registry.register({
      id: "custom",
      canCapture: () => false,
      capture: () => undefined,
    });
    const part = {
      id: "custom-1",
      kind: "custom",
      extensionId: "custom",
      node: { type: "custom" },
    };
    unregister();

    expect(() => registry.restore(part)).toThrow("is not registered");
    expect(() =>
      registry.dispose(part, { attachmentFiles: new Map() }),
    ).toThrow("is not registered");
  });

  it("delegates attachment disposal to the resource owner", () => {
    const file = new File(["x"], "x.png", { type: "image/png" });
    const disposeAttachment = vi.fn();
    const registry = createDefaultEditorComposePartRegistry();
    const [part] = registry.capture(
      {
        type: "doc",
        content: [
          {
            type: "attachment",
            attrs: { id: "a", previewUrl: "blob:a" },
          },
        ],
      },
      { attachmentFiles: new Map([["a", file]]) },
    );

    registry.dispose(part, {
      attachmentFiles: new Map([["a", file]]),
      disposeAttachment,
    });

    expect(disposeAttachment).toHaveBeenCalledWith("a", "blob:a");
  });
});
