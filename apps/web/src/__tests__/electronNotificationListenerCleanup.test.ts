import { beforeEach, describe, expect, it, vi } from "vitest";
/**
 * Unit tests for Electron notification IPC listener cleanup
 * Tests that IPC listeners are properly managed to prevent memory leaks (fix for issue #349).
 *
 * These tests import the real `subscribeDisposable` helper used by the preload
 * bridge (see src-election/preload/notificationListeners.ts) so the assertions
 * cannot silently drift away from the shipped implementation.
 */
import { subscribeDisposable } from "../../src-election/preload/notificationListeners";

describe("Electron notification IPC listener cleanup", () => {
  const mockOn = vi.fn();
  const mockRemoveListener = vi.fn();

  const mockIpcRenderer = {
    on: mockOn,
    removeListener: mockRemoveListener,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const onClicked = (callback: (data: any) => void) =>
    subscribeDisposable(mockIpcRenderer, "notification-clicked", callback);
  const onActionClicked = (callback: (data: any) => void) =>
    subscribeDisposable(
      mockIpcRenderer,
      "notification-action-clicked",
      callback
    );

  describe("onClicked", () => {
    it("should register a new listener for notification-clicked channel", () => {
      onClicked(vi.fn());

      expect(mockOn).toHaveBeenCalledWith(
        "notification-clicked",
        expect.any(Function)
      );
    });

    it("should return an idempotent cleanup function that removes the listener", () => {
      const cleanup = onClicked(vi.fn());

      expect(typeof cleanup).toBe("function");

      cleanup();
      cleanup();

      expect(mockRemoveListener).toHaveBeenCalledTimes(1);
      expect(mockRemoveListener).toHaveBeenCalledWith(
        "notification-clicked",
        expect.any(Function)
      );
    });

    it("should call the callback with data when notification is clicked", () => {
      const callback = vi.fn();

      onClicked(callback);

      // Get the handler that was registered
      const registeredHandler = mockOn.mock.calls[0][1];
      const testData = { tag: "test-tag", payload: { id: 123 } };

      // Simulate IPC event
      registeredHandler({}, testData);

      expect(callback).toHaveBeenCalledWith(testData);
    });

    it("should keep multiple notification listeners independent", () => {
      // Call multiple times (simulating component remounts)
      onClicked(vi.fn());
      onClicked(vi.fn());
      onClicked(vi.fn());

      expect(mockOn).toHaveBeenCalledTimes(3);
    });
  });

  describe("onActionClicked", () => {
    it("should register a new listener for notification-action-clicked channel", () => {
      onActionClicked(vi.fn());

      expect(mockOn).toHaveBeenCalledWith(
        "notification-action-clicked",
        expect.any(Function)
      );
    });

    it("should return an idempotent cleanup function that removes the listener", () => {
      const cleanup = onActionClicked(vi.fn());

      expect(typeof cleanup).toBe("function");

      cleanup();
      cleanup();

      expect(mockRemoveListener).toHaveBeenCalledTimes(1);
      expect(mockRemoveListener).toHaveBeenCalledWith(
        "notification-action-clicked",
        expect.any(Function)
      );
    });

    it("should call the callback with data when action is clicked", () => {
      const callback = vi.fn();

      onActionClicked(callback);

      // Get the handler that was registered
      const registeredHandler = mockOn.mock.calls[0][1];
      const testData = { action: "reply", payload: { text: "hello" } };

      // Simulate IPC event
      registeredHandler({}, testData);

      expect(callback).toHaveBeenCalledWith(testData);
    });
  });
});
