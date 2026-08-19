import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ExtensionChatSendOperation } from "../../domain";
import {
  ChatSendOperationRegistry,
  type ChatSendOperationHandler,
} from "../ChatSendOperationRegistry";

type LocationOperation = ExtensionChatSendOperation<unknown, { lat: number }> & {
  kind: "extension:location";
};

describe("ChatSendOperationRegistry", () => {
  const events = { onEnqueued: vi.fn() };

  it("registers a typed extension operation and returns an unregister handle", async () => {
    const registry = new ChatSendOperationRegistry();
    const handled: LocationOperation[] = [];
    const handler = vi.fn(async (operation) => {
      handled.push(operation as LocationOperation);
      return { enqueuedPartIds: operation.partIds };
    });
    const unregister = registry.register(
      "extension:location",
      handler,
    );
    const operation: LocationOperation = {
      kind: "extension:location",
      partIds: ["location:0"],
      payload: { lat: 31.2 },
    };

    await expect(registry.get(operation)?.(operation, events)).resolves.toEqual({
      enqueuedPartIds: ["location:0"],
    });
    expect(handler).toHaveBeenCalledWith(operation, events);
    expect(handled).toEqual([operation]);
    expect(unregister()).toBe(true);
    expect(registry.get(operation)).toBeUndefined();
  });

  it("infers extension and built-in operation shapes from the kind", () => {
    const registry = new ChatSendOperationRegistry();
    registry.register("extension:poll", async (operation) => {
      expectTypeOf(operation.payload).toEqualTypeOf<unknown>();
      return { enqueuedPartIds: operation.partIds };
    });
    registry.register("send_text", async (operation) => {
      expectTypeOf(operation.text).toEqualTypeOf<string>();
      return { enqueuedPartIds: operation.partIds };
    });
  });

  it("accepts an already typed extension handler without explicit generics", () => {
    const registry = new ChatSendOperationRegistry();
    const handler: ChatSendOperationHandler<unknown, LocationOperation> = async (
      operation,
    ) => ({ enqueuedPartIds: operation.partIds });

    registry.register("extension:location", handler);

    expect(registry.has("extension:location")).toBe(true);
  });

  it("rejects duplicate operation kinds", () => {
    const registry = new ChatSendOperationRegistry();
    registry.register("send_text", async () => ({ enqueuedPartIds: [] }));

    expect(() =>
      registry.register("send_text", async () => ({ enqueuedPartIds: [] })),
    ).toThrow("already registered");
  });

  it("does not let a stale disposer unregister a replacement handler", async () => {
    const registry = new ChatSendOperationRegistry();
    const disposeFirst = registry.register("send_text", async () => ({
      enqueuedPartIds: ["first"],
    }));
    registry.unregister("send_text");
    const replacement = vi.fn(async () => ({
      enqueuedPartIds: ["replacement"],
    }));
    registry.register("send_text", replacement);
    const operation = {
      kind: "send_text" as const,
      partIds: ["text:0"],
      text: "hello",
    };

    expect(disposeFirst()).toBe(false);
    await registry.get(operation)?.(operation, events);
    expect(replacement).toHaveBeenCalledOnce();
  });

  it("keeps an attempt snapshot stable when live handlers change", async () => {
    const registry = new ChatSendOperationRegistry();
    const first = vi.fn(async () => ({ enqueuedPartIds: ["first"] }));
    const replacement = vi.fn(async () => ({ enqueuedPartIds: ["replacement"] }));
    registry.register("send_text", first);
    const snapshot = registry.snapshot();
    registry.unregister("send_text");
    registry.register("send_text", replacement);
    const operation = {
      kind: "send_text" as const,
      partIds: ["text:0"],
      text: "hello",
    };

    await snapshot.get(operation)?.(operation, events);

    expect(first).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });
});
