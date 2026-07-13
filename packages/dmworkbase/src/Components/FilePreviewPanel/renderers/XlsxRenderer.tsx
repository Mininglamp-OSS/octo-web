import React, { useEffect, useRef } from "react";
import { XlsxViewer } from "@silurus/ooxml/xlsx";
import { BaseRendererProps } from "../types";
import { isFileTooLarge } from "../config";
import { useFileContent } from "../hooks/useFileContent";
import { useRendererState } from "../hooks/useRendererState";
import { RendererState } from "./RendererState";
import FileTooLarge from "./FileTooLarge";
import "./OfficeRenderer.css";

export interface XlsxRendererProps extends BaseRendererProps {}

/** Canvas-based OOXML renderer for Excel workbooks. */
const XlsxRenderer: React.FC<XlsxRendererProps> = ({ file, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<XlsxViewer | null>(null);

  const tooLarge = !!(file.size && isFileTooLarge(file.size));
  const { content, loading, error, reload } = useFileContent({
    url: file.url,
    responseType: "arraybuffer",
    enabled: !tooLarge,
  });

  const { status, setError, setReady } = useRendererState();

  useEffect(() => {
    if (!content || !containerRef.current || tooLarge) return;

    let cancelled = false;
    const container = containerRef.current;

    // Guard: container must have dimensions to render into
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;

    const viewer = new XlsxViewer(container);
    viewerRef.current = viewer;

    viewer
      .load(content.slice(0))
      .then(() => {
        if (cancelled) return;
        setReady();
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const msg = cause instanceof Error ? cause.message : "Unable to render Excel workbook";
        setError(msg);
        onError?.(msg);
      });

    return () => {
      cancelled = true;
      try {
        viewer.destroy();
      } catch {
        // viewer may already be destroyed
      }
      viewerRef.current = null;
    };
  }, [content, onError, tooLarge, setError, setReady]);

  if (tooLarge) {
    return <FileTooLarge fileName={file.name} fileSize={file.size ?? 0} fileUrl={file.url} />;
  }
  if (loading) return <RendererState type="loading" />;
  if (error) return <RendererState type="error" message={error} onRetry={reload} />;
  if (status === "error") return <RendererState type="error" onRetry={reload} />;

  return (
    <div className="wk-file-preview-office-renderer">
      <div
        ref={containerRef}
        className="wk-file-preview-office-renderer__workbook"
        aria-label={file.name}
      />
    </div>
  );
};

export default XlsxRenderer;
