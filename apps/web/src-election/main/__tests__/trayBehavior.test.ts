import { describe, expect, it, vi } from "vitest";
import { attachTrayPrimaryClick } from "../trayBehavior";

describe("tray primary click behavior", () => {
  it("restores the main window on primary click", () => {
    let onClick: (() => void) | undefined;
    const tray = {
      on: vi.fn((event: "click", listener: () => void) => {
        if (event === "click") onClick = listener;
      }),
    };
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };

    attachTrayPrimaryClick(tray, () => mainWindow);
    onClick?.();

    expect(tray.on).toHaveBeenCalledWith("click", expect.any(Function));
    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
  });

  it("does nothing when the main window has been destroyed", () => {
    let onClick: (() => void) | undefined;
    const tray = {
      on: vi.fn((_event: "click", listener: () => void) => {
        onClick = listener;
      }),
    };
    const mainWindow = {
      isDestroyed: vi.fn(() => true),
      show: vi.fn(),
      focus: vi.fn(),
    };

    attachTrayPrimaryClick(tray, () => mainWindow);
    onClick?.();

    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).not.toHaveBeenCalled();
  });
});
