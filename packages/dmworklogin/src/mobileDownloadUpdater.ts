import React from "react";
import { apiFetchJson, WKApp } from "@octo/base";

export function resolveMobileUpdaterUrl(
  updaterPath: string,
  apiUrl = WKApp.apiClient.config.apiURL
) {
  return `${apiUrl.replace(/\/?$/, "/")}${updaterPath}`;
}

function resolveSafeDownloadUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // Invalid updater responses use the caller-provided fallback URL.
  }
  return undefined;
}

export async function fetchMobileDownloadUrl(
  updaterPath: string,
  fallbackUrl: string
) {
  try {
    const result = await apiFetchJson<{ url?: unknown }>(
      resolveMobileUpdaterUrl(updaterPath)
    );
    return resolveSafeDownloadUrl(result?.url) ?? fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

export function useMobileDownloadUrl(updaterPath: string, fallbackUrl: string) {
  const [downloadUrl, setDownloadUrl] = React.useState(fallbackUrl);
  const requestRef = React.useRef<Promise<string>>();

  const resolveDownloadUrl = React.useCallback(() => {
    if (!requestRef.current) {
      requestRef.current = fetchMobileDownloadUrl(updaterPath, fallbackUrl);
    }
    return requestRef.current;
  }, [fallbackUrl, updaterPath]);

  React.useEffect(() => {
    let active = true;
    void resolveDownloadUrl().then((url) => {
      if (active) setDownloadUrl(url);
    });
    return () => {
      active = false;
    };
  }, [resolveDownloadUrl]);

  return { downloadUrl, resolveDownloadUrl };
}

export function startMobileDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
