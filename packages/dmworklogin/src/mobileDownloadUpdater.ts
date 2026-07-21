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
    // Invalid updater responses are treated as load failures.
  }
  return undefined;
}

export async function fetchMobileDownloadUrl(updaterPath: string) {
  const result = await apiFetchJson<{ url?: unknown }>(
    resolveMobileUpdaterUrl(updaterPath)
  );
  const downloadUrl = resolveSafeDownloadUrl(result?.url);
  if (!downloadUrl) throw new Error("Updater returned an invalid download URL");
  return downloadUrl;
}

type MobileDownloadUrlState =
  | { status: "loading"; downloadUrl?: undefined }
  | { status: "ready"; downloadUrl: string }
  | { status: "error"; downloadUrl?: undefined };

export function useMobileDownloadUrl(updaterPath: string) {
  const [state, setState] = React.useState<MobileDownloadUrlState>({
    status: "loading",
  });
  const requestIdRef = React.useRef(0);

  const load = React.useCallback(() => {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    void fetchMobileDownloadUrl(updaterPath).then(
      (downloadUrl) => {
        if (requestId === requestIdRef.current) {
          setState({ status: "ready", downloadUrl });
        }
      },
      () => {
        if (requestId === requestIdRef.current) {
          setState({ status: "error" });
        }
      }
    );
  }, [updaterPath]);

  React.useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  return { ...state, retry: load };
}
