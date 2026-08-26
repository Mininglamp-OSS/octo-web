export interface TrayWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function restoreMainWindow(mainWindow: TrayWindow | null | undefined): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function attachTrayPrimaryClick(
  tray: { on(event: "click", listener: () => void): void },
  getMainWindow: () => TrayWindow | null | undefined,
): void {
  tray.on("click", () => restoreMainWindow(getMainWindow()));
}

export function attachTraySecondaryMenu(
  tray: { on(event: "right-click", listener: () => void): void; popUpContextMenu(menu: unknown): void },
  menu: unknown,
): void {
  tray.on("right-click", () => tray.popUpContextMenu(menu));
}
