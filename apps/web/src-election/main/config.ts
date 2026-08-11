import { readFileSync } from "fs";
import { join } from "path";

const OCTO_CONFIG = {
  appId: "com.mininglamp.octo.web",
  name: "OCTO",
  updateUrl: 'https://api.example.com/'
};

function readBuiltOidcApiOrigin(): string | null | undefined {
  try {
    const raw = readFileSync(join(__dirname, "../../build/electron-config.json"), "utf8");
    const value = JSON.parse(raw)?.oidcApiOrigin;
    return typeof value === "string" ? value : null;
  } catch {
    return undefined;
  }
}

// The Electron main process must get the OIDC API origin from build/runtime
// configuration, never from an IPC argument supplied by the renderer. The
// packaged renderer build emits electron-config.json; process.env remains a
// development fallback because Vite env is not available to the tsc-built
// main process in a packaged application.
export const OIDC_API_ORIGIN = (() => {
  const built = readBuiltOidcApiOrigin();
  const raw = built !== undefined ? built : process.env.VITE_API_URL;
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
})();

export default OCTO_CONFIG;
