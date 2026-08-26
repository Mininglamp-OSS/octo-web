export interface TrayWindow {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
}

export function restoreMainWindow(mainWindow: TrayWindow | null | undefined): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

export function attachTrayPrimaryClick(
  tray: { on(event: "click", listener: () => void): void },
  getMainWindow: () => TrayWindow | null | undefined,
): void {
  tray.on("click", () => restoreMainWindow(getMainWindow()));
}
