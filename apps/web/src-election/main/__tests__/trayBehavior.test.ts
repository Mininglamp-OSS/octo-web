import { describe, expect, it, vi } from "vitest";
import { attachTrayPrimaryClick, attachTraySecondaryMenu } from "../trayBehavior";

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
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };

    attachTrayPrimaryClick(tray, () => mainWindow);
    onClick?.();

    expect(tray.on).toHaveBeenCalledWith("click", expect.any(Function));
    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
  });

  it("restores a minimized main window before focusing it", () => {
    let onClick: (() => void) | undefined;
    const tray = {
      on: vi.fn((_event: "click", listener: () => void) => {
        onClick = listener;
      }),
    };
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };

    attachTrayPrimaryClick(tray, () => mainWindow);
    onClick?.();

    expect(mainWindow.restore).toHaveBeenCalledOnce();
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
      isMinimized: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };

    attachTrayPrimaryClick(tray, () => mainWindow);
    onClick?.();

    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).not.toHaveBeenCalled();
  });

  it("opens the context menu on secondary click", () => {
    let onRightClick: (() => void) | undefined;
    const tray = {
      on: vi.fn((_event: "right-click", listener: () => void) => {
        onRightClick = listener;
      }),
      popUpContextMenu: vi.fn(),
    };
    const menu = {};

    attachTraySecondaryMenu(tray, menu);
    onRightClick?.();

    expect(tray.popUpContextMenu).toHaveBeenCalledOnce();
    expect(tray.popUpContextMenu).toHaveBeenCalledWith(menu);
  });
});
