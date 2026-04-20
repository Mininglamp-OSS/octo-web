import { isSafeUrl } from "./security";

export const BLOB_DOWNLOAD_SIZE_LIMIT = 500 * 1024 * 1024; // 500 MB

/**
 * Download a file with correct filename.
 * Same-origin URLs use direct anchor download; cross-origin uses fetch+Blob.
 * Falls back to anchor-click on error or for oversized files.
 */
export async function downloadFile(
    url: string,
    filename: string,
    opts?: {
        fileSize?: number;
        sizeLimit?: number;
        onProgress?: (pct: number) => void;
        onStart?: () => void;
        onEnd?: () => void;
    },
): Promise<void> {
    if (!url) return;

    // Resolve any URL format (relative, absolute, etc.) to full absolute URL
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url, window.location.href);
    } catch {
        return; // Invalid URL
    }

    const resolvedUrl = parsedUrl.href;
    if (!isSafeUrl(resolvedUrl)) return;

    const limit = opts?.sizeLimit ?? BLOB_DOWNLOAD_SIZE_LIMIT;

    // Same-origin: <a download> works natively, no need for fetch+blob
    if (parsedUrl.origin === window.location.origin) {
        fallbackAnchorDownload(resolvedUrl, filename);
        return;
    }

    // Cross-origin: fetch+blob to preserve filename

    // Pre-check: skip fetch entirely when caller provides known file size
    if (opts?.fileSize && opts.fileSize > limit) {
        fallbackAnchorDownload(resolvedUrl, filename);
        return;
    }

    opts?.onStart?.();
    try {
        const resp = await fetch(resolvedUrl);
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

        // Runtime Content-Length enforcement: abort before reading body
        const contentLengthStr = resp.headers.get("Content-Length");
        const declaredSize = contentLengthStr ? parseInt(contentLengthStr, 10) : NaN;
        if (!isNaN(declaredSize) && declaredSize > limit) {
            if (resp.body) {
                resp.body.cancel().catch(() => {});
            }
            fallbackAnchorDownload(resolvedUrl, filename);
            return;
        }

        // Stream body with runtime byte-count enforcement
        if (resp.body) {
            const reader = resp.body.getReader();
            const chunks: Uint8Array[] = [];
            let received = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.byteLength;
                // Streaming byte limit: abort if actual data exceeds limit
                if (received > limit) {
                    reader.cancel().catch(() => {});
                    fallbackAnchorDownload(resolvedUrl, filename);
                    return;
                }
                if (opts?.onProgress && !isNaN(declaredSize)) {
                    opts.onProgress(Math.round((received / declaredSize) * 100));
                }
            }
            const blob = new Blob(chunks);
            triggerBlobDownload(blob, filename);
        } else {
            // Fallback for environments without ReadableStream body
            const blob = await resp.blob();
            if (blob.size > limit) {
                fallbackAnchorDownload(resolvedUrl, filename);
                return;
            }
            triggerBlobDownload(blob, filename);
        }
    } catch (err) {
        console.warn('[downloadFile] blob download failed, falling back to anchor:', err);
        fallbackAnchorDownload(resolvedUrl, filename);
    } finally {
        opts?.onEnd?.();
    }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;   // Blob URL is same-origin; download attribute works
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/**
 * Fallback download via anchor-click.
 * Used when fetch+Blob fails or for oversized files.
 * The filename hint works for same-origin; ignored for cross-origin.
 * For cross-origin URLs, opens in a new tab to avoid navigating away from the app.
 */
export function fallbackAnchorDownload(url: string, filename: string): void {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    try {
        const parsed = new URL(url, window.location.href);
        if (parsed.origin !== window.location.origin) {
            a.target = '_blank';
            a.rel = 'noopener';
        }
    } catch { /* keep default */ }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
