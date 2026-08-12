import { describe, expect, it, vi } from "vitest";
import type { ExtensionChatSendOperation } from "../../submission";
import { ChatSendOperationRegistry } from "../ChatSendOperationRegistry";

type LocationOperation = ExtensionChatSendOperation<unknown, { lat: number }> & {
  kind: "extension:location";
};

describe("ChatSendOperationRegistry", () => {
  it("registers a typed extension operation and returns an unregister handle", async () => {
    const registry = new ChatSendOperationRegistry();
    const handler = vi.fn(async (operation: LocationOperation) => ({
      enqueuedPartIds: operation.partIds,
    }));
    const unregister = registry.register<LocationOperation>(
      "extension:location",
      handler,
    );
    const operation: LocationOperation = {
      kind: "extension:location",
      partIds: ["location:0"],
      payload: { lat: 31.2 },
    };

    await expect(registry.get(operation)?.(operation)).resolves.toEqual({
      enqueuedPartIds: ["location:0"],
    });
    expect(handler).toHaveBeenCalledWith(operation);
    expect(unregister()).toBe(true);
    expect(registry.get(operation)).toBeUndefined();
  });

  it("rejects duplicate operation kinds", () => {
    const registry = new ChatSendOperationRegistry();
    registry.register("send_text", async () => ({ enqueuedPartIds: [] }));

    expect(() =>
      registry.register("send_text", async () => ({ enqueuedPartIds: [] })),
    ).toThrow("already registered");
  });
});
