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

function readBuiltOidcEndSessionOrigins(): string[] | undefined {
  try {
    const raw = readFileSync(join(__dirname, "../../build/electron-config.json"), "utf8");
    const value = JSON.parse(raw)?.oidcEndSessionOrigins;
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    if (typeof item !== "string" || item.trim() === "") return [];
    try {
      const parsed = new URL(item.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:"
        ? [parsed.origin]
        : [];
    } catch {
      return [];
    }
  })));
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

// End-session hosts are build-time trust configuration. The renderer must not
// be able to nominate an IdP host through the logout IPC. Keep the API origin
// as a conservative default; deployments with external IdPs must set
// VITE_OIDC_TRUSTED_ORIGINS to a comma-separated list of all required origins.
const builtEndSessionOrigins = normalizeOrigins(readBuiltOidcEndSessionOrigins());
const envEndSessionOrigins = normalizeOrigins(
  (process.env.VITE_OIDC_TRUSTED_ORIGINS || "").split(","),
);
export const OIDC_END_SESSION_ORIGINS = new Set([
  ...(builtEndSessionOrigins.length > 0 ? builtEndSessionOrigins : envEndSessionOrigins),
  ...(OIDC_API_ORIGIN ? [OIDC_API_ORIGIN] : []),
]);

export default OCTO_CONFIG;
