import path from "path";
import { app, screen } from "electron";

export default path.join(app.getAppPath(), "./resources/logo.png");

export function getNoMessageTrayIcon () {
  if (process.platform === 'darwin') {
    return path.join(app.getAppPath(), './resources/tray/macTray@3x.png')
  } else if (process.platform === 'win32') {
    return path.join(app.getAppPath(), './resources/tray/128x128.png')
  } else if (screen.getPrimaryDisplay().scaleFactor > 1) {
    return path.join(app.getAppPath(), './resources/tray/128x128.png')
  } else {
    return path.join(app.getAppPath(), './resources/tray/128x128.png')
  }
}