import { readFileSync } from "fs";
import { join } from "path";

const DEFAULT_ELECTRON_UPDATER_API_PATH = "/api/v1/common/updater/";

function isLocalhostHttpUrl(url: URL): boolean {
  return url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
}

function normalizeDirectoryUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !isLocalhostHttpUrl(url)) return "";
    if (url.search || url.hash) return "";
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    return "";
  }
}

function deriveUpdaterApiUrlFromApiUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const apiOrigin = new URL(value).origin;
    return new URL(DEFAULT_ELECTRON_UPDATER_API_PATH, apiOrigin).toString();
  } catch {
    return undefined;
  }
}

function readBuiltElectronUpdaterApiUrl(): string | null | undefined {
  return readBuiltString("electronUpdaterApiUrl");
}

function readBuiltElectronUpdateSigningTeamId(): string | null | undefined {
  return readBuiltString("electronUpdateSigningTeamId");
}

function readBuiltElectronUpdateWindowsPublisherName(): string | null | undefined {
  return readBuiltString("electronUpdateWindowsPublisherName");
}

function readBuiltString(key: string): string | null | undefined {
  try {
    const raw = readFileSync(join(__dirname, "../../build/electron-config.json"), "utf8");
    const value = JSON.parse(raw)?.[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

function readElectronUpdaterApiUrl(): string | undefined {
  const built = readBuiltElectronUpdaterApiUrl();
  const raw = built !== undefined
    ? built
    : process.env.VITE_ELECTRON_UPDATER_API_URL ||
      process.env.ELECTRON_UPDATER_API_URL ||
      deriveUpdaterApiUrlFromApiUrl(process.env.VITE_API_URL);
  const normalized = raw ? normalizeDirectoryUrl(raw) : "";
  return normalized || undefined;
}

const OCTO_CONFIG = {
  appId: "com.mininglamp.octo.web",
  name: "OCTO",
  updaterApiUrl: readElectronUpdaterApiUrl(),
  updaterCodeSigningTeamId: (readBuiltElectronUpdateSigningTeamId() ?? process.env.ELECTRON_UPDATE_SIGNING_TEAM_ID ?? "").trim(),
  updaterWindowsPublisherName: (readBuiltElectronUpdateWindowsPublisherName() ?? process.env.ELECTRON_UPDATE_WINDOWS_PUBLISHER_NAME ?? "").trim(),
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
