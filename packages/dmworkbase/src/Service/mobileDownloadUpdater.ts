import React from "react";

export type MobileDownloadFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<unknown>;

export const MOBILE_DOWNLOAD_REQUEST_TIMEOUT_MS = 20_000;

export type MobileDownloadUrlState =
  | { status: "idle" | "loading" | "error"; downloadUrl?: undefined }
  | { status: "ready"; downloadUrl: string };

export function resolveMobileUpdaterUrl(
  updaterPath: string,
  apiUrl: string,
) {
  return `${apiUrl.replace(/\/?$/, "/")}${updaterPath.replace(/^\/+/, "")}`;
}

export function resolveSafeDownloadUrl(
  value: unknown,
  baseUrl: string | null = null,
) {
  if (typeof value !== "string") return undefined;
  const normalizedValue = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!normalizedValue) return undefined;
  try {
    const url = baseUrl === null
      ? new URL(normalizedValue)
      : new URL(normalizedValue, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchMobileDownloadUrl(
  updaterPath: string,
  fetcher: MobileDownloadFetcher,
  apiUrl: string,
  signal?: AbortSignal,
  downloadBaseUrl: string | null = null,
) {
  const controller = new AbortController();
  const abortExternalRequest = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortExternalRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(), MOBILE_DOWNLOAD_REQUEST_TIMEOUT_MS);
  try {
    const result = await fetcher(resolveMobileUpdaterUrl(updaterPath, apiUrl), { signal: controller.signal });
    const downloadUrl = resolveSafeDownloadUrl(
      result && typeof result === "object" && "url" in result
        ? (result as { url?: unknown }).url
        : undefined,
      downloadBaseUrl,
    );
    if (!downloadUrl) throw new Error("Updater returned an invalid download URL");
    return downloadUrl;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortExternalRequest);
  }
}

export function useMobileDownloadUrl(
  updaterPath: string | undefined,
  fetcher: MobileDownloadFetcher,
  apiUrl: string,
  downloadBaseUrl: string | null = null,
) {
  const [state, setState] = React.useState<MobileDownloadUrlState>({
    status: updaterPath ? "loading" : "idle",
  });
  const requestIdRef = React.useRef(0);
  const requestControllerRef = React.useRef<AbortController>();

  const load = React.useCallback(() => {
    requestControllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    if (!updaterPath) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const controller = new AbortController();
    requestControllerRef.current = controller;
    void fetchMobileDownloadUrl(updaterPath, fetcher, apiUrl, controller.signal, downloadBaseUrl).then(
      (downloadUrl) => {
        if (requestId === requestIdRef.current) setState({ status: "ready", downloadUrl });
      },
      () => {
        if (requestId === requestIdRef.current) setState({ status: "error" });
      },
    );
  }, [apiUrl, downloadBaseUrl, fetcher, updaterPath]);

  React.useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
      requestControllerRef.current?.abort();
    };
  }, [load]);

  return { ...state, retry: load };
}
