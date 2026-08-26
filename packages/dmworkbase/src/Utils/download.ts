import { isSafeUrl } from "./security";
import WKApp from "../App";
import { getElectronIpcBridge, isElectronPowered } from "../electron/desktopBridge";
import { IPC_DOWNLOAD_STATUS, IPC_DOWNLOAD_URL } from "../../../../apps/web/src-election/shared/ipc-channels";
import { Toast } from "@douyinfe/semi-ui";
import { t } from "../i18n";

/**
 * Get a presigned download URL from the backend.
 * Falls back to the original URL on error.
 */
export async function getPresignedDownloadUrl(remotePath: string, filename: string): Promise<string> {
    try {
        const resp = await WKApp.apiClient.get(`file/download/url?path=${encodeURIComponent(remotePath)}&filename=${encodeURIComponent(filename)}`)
        if (resp && resp.url) {
            return resp.url
        }
    } catch (err) {
        console.warn("getPresignedDownloadUrl: failed, falling back to original URL", err)
    }
    return remotePath
}

/**
 * Get a presigned preview URL (Content-Disposition: inline) from the backend.
 * Falls back to the original URL on error.
 */
export async function getPresignedPreviewUrl(remotePath: string, filename: string): Promise<string> {
    try {
        const resp = await WKApp.apiClient.get(`file/download/url?path=${encodeURIComponent(remotePath)}&filename=${encodeURIComponent(filename)}&disposition=inline`)
        if (resp && resp.url) {
            return resp.url
        }
    } catch (err) {
        console.warn("getPresignedPreviewUrl: failed, falling back to original URL", err)
    }
    return remotePath
}

/**
 * Download a file via anchor-click.
 * For cross-origin URLs, fetches a presigned download URL from the backend.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
    if (!url) return;

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url, window.location.href);
    } catch {
        return;
    }

    const resolvedUrl = parsedUrl.href;
    if (!isSafeUrl(resolvedUrl)) return;

    let downloadUrl = resolvedUrl;
    const isCrossOrigin = parsedUrl.origin !== window.location.origin;

    if (isCrossOrigin && filename) {
        downloadUrl = await getPresignedDownloadUrl(resolvedUrl, filename);
    }

    if (isElectronPowered()) {
        const ipc = getElectronIpcBridge();
        if (ipc) {
            const displayName = (value: string) => value.length > 48 ? `${value.slice(0, 45)}…` : value;
            const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
            let cleanup = () => undefined;
            const onStatus = (_event: unknown, ...args: unknown[]) => {
                    const status = (args[0] || {}) as { id?: string; state?: string; filename?: string };
                    if (status?.id !== id) return;
                    if (status.state === "completed") {
                        Toast.success({ content: t("base.download.completed", { values: { filename: displayName(status.filename || filename) } }), duration: 2.5 });
                        cleanup();
                    }
                    if (status.state === "failed") {
                        Toast.error({ content: t("base.download.failed", { values: { filename: displayName(status.filename || filename) } }), duration: 3 });
                        cleanup();
                    }
                    if (status.state === "cancelled" || status.state === "expired") {
                        cleanup();
                    }
            };
            cleanup = () => {
                ipc.removeListener(IPC_DOWNLOAD_STATUS, onStatus);
                if (cleanupTimer) clearTimeout(cleanupTimer);
            };
            ipc.on(IPC_DOWNLOAD_STATUS, onStatus);
            cleanupTimer = setTimeout(cleanup, 10 * 60 * 1000);
            try {
                await ipc.invoke(IPC_DOWNLOAD_URL, downloadUrl, filename, id);
                return;
            } catch (error) {
                cleanup();
                console.warn("downloadFile: Electron download failed, falling back to browser download", error);
            }
        }
    }

    try {
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = filename;
        if (isCrossOrigin) {
            a.target = "_blank";
            a.rel = "noopener";
        }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        console.warn("downloadFile: anchor click failed, trying window.open", err);
        try {
            const w = window.open(downloadUrl, "_blank");
            if (!w) {
                console.warn("downloadFile: window.open returned null (popup blocked?)");
            }
        } catch (err2) {
            console.warn("downloadFile: window.open also failed", err2);
        }
    }
}
