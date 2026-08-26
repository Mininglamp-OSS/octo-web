import { WKApp } from "@octo/base";

const DEFAULT_MARKET_API_PATH = "/market/api/v1";

/**
 * Resolve the skill marketplace API base at request time.
 *
 * Web builds stay same-origin so dev Vite proxy / production gateway can
 * rewrite `/market`. Packaged desktop builds use an absolute WKApp apiURL
 * (`https://host/v1/`), so same-origin would resolve against `file://` and
 * fail; in that case route marketplace calls to the API origin.
 */
export function resolveSkillMarketApiBaseURL(): string {
  const meta = (import.meta as { env?: Record<string, string | undefined> }) ?? {};
  const override = meta.env?.VITE_SKILL_MARKET_API_BASE?.trim();
  if (override) return override.replace(/\/$/, "");

  const apiURL = WKApp.apiClient?.config?.apiURL;
  if (!apiURL) return DEFAULT_MARKET_API_PATH;
  try {
    return `${new URL(apiURL).origin}${DEFAULT_MARKET_API_PATH}`;
  } catch {
    return DEFAULT_MARKET_API_PATH;
  }
}
