import React, { useCallback, useEffect, useRef } from "react";
import { DocxDocument } from "@silurus/ooxml/docx";
import { PptxPresentation } from "@silurus/ooxml/pptx";
import { BaseRendererProps } from "../types";
import { isFileTooLarge } from "../config";
import { useFileContent } from "../hooks/useFileContent";
import { useResizeObserver } from "../hooks/useResizeObserver";
import { useRendererState } from "../hooks/useRendererState";
import { usePagination } from "../hooks/usePagination";
import { RendererState } from "./RendererState";
import FileTooLarge from "./FileTooLarge";
import "./OfficeRenderer.css";

type OfficeFormat = "docx" | "pptx";

export interface OfficeRendererProps extends BaseRendererProps {
  format: OfficeFormat;
}

const RENDER_WIDTH = 960;
const VIEWPORT_PADDING = 32;

type Engine = DocxDocument | PptxPresentation;

/** Get total page/slide count from the engine. */
function getTotal(engine: Engine, format: OfficeFormat): number {
  try {
    return format === "docx"
      ? (engine as DocxDocument).pageCount
      : (engine as PptxPresentation).slideCount;
  } catch {
    return 0;
  }
}

/** Render a single page/slide onto the canvas. */
async function renderPage(
  engine: Engine,
  canvas: HTMLCanvasElement,
  index: number,
  format: OfficeFormat,
): Promise<void> {
  if (format === "docx") {
    await (engine as DocxDocument).renderPage(canvas, index, { width: RENDER_WIDTH });
  } else {
    await (engine as PptxPresentation).renderSlide(canvas, index, { width: RENDER_WIDTH });
  }
}

/** Set canvas CSS size to fit inside the viewport while preserving aspect ratio. */
function fitCanvas(canvas: HTMLCanvasElement, viewportW: number, viewportH: number) {
  const cw = canvas.width;
  const ch = canvas.height;
  if (cw <= 0 || ch <= 0) return;

  const ratio = cw / ch;
  const maxW = Math.max(viewportW - VIEWPORT_PADDING, 1);
  const maxH = Math.max(viewportH - VIEWPORT_PADDING, 1);

  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }

  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(h)}px`;
}

/** Canvas-based OOXML renderer for Word and PowerPoint documents. */
const OfficeRenderer: React.FC<OfficeRendererProps> = ({ file, format, onError }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  const tooLarge = !!(file.size && isFileTooLarge(file.size));
  const { content, loading, error, reload } = useFileContent({
    url: file.url,
    responseType: "arraybuffer",
    enabled: !tooLarge,
  });

  const { status, setError, setReady, reset } = useRendererState();
  const { page, goPrev, goNext, canGoPrev, canGoNext, reset: resetPage } = usePagination();

  // ── Load document ──────────────────────────────────────────────
  useEffect(() => {
    if (!content || !canvasRef.current || tooLarge) return;

    let cancelled = false;
    reset();
    resetPage(0);

    const loadFn = format === "docx" ? DocxDocument.load : PptxPresentation.load;
    const buffer = content.slice(0);

    loadFn(buffer)
      .then(async (engine: Engine) => {
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;

        const total = getTotal(engine, format);
        resetPage(total);

        const canvas = canvasRef.current;
        const viewport = viewportRef.current;
        if (!canvas || !viewport) return;

        await renderPage(engine, canvas, 0, format);
        fitCanvas(canvas, viewport.clientWidth, viewport.clientHeight);

        if (!cancelled) setReady();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Unable to render document";
        setError(msg);
        onError?.(msg);
      });

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [content, format, onError, tooLarge, reset, resetPage, setReady, setError]);

  // ── Render current page on page change ─────────────────────────
  useEffect(() => {
    if (status !== "ready" || page.current === 0 && page.total > 0) {
      // Skip initial render — already done in load effect
      if (page.current === 0) return;
    }
    if (status !== "ready") return;

    const canvas = canvasRef.current;
    const engine = engineRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !engine || !viewport) return;

    let cancelled = false;
    renderPage(engine, canvas, page.current, format)
      .then(() => {
        if (!cancelled) fitCanvas(canvas, viewport.clientWidth, viewport.clientHeight);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Render failed";
        setError(msg);
        onError?.(msg);
      });

    return () => {
      cancelled = true;
    };
  }, [page.current, status, format, setError, onError]);

  // ── Refit on container resize ──────────────────────────────────
  useResizeObserver(
    viewportRef,
    (w, h) => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
      fitCanvas(canvas, w, h);
    },
    [status],
  );

  // ── Render guards ──────────────────────────────────────────────
  if (tooLarge) {
    return <FileTooLarge fileName={file.name} fileSize={file.size ?? 0} fileUrl={file.url} />;
  }
  if (loading) return <RendererState type="loading" />;
  if (error) return <RendererState type="error" message={error} onRetry={reload} />;
  if (status === "error") return <RendererState type="error" message={"Unable to render document"} onRetry={reload} />;

  return (
    <div className="wk-file-preview-office-renderer">
      <div className="wk-file-preview-office-renderer__toolbar">
        <button
          className="wk-file-preview-office-renderer__nav-btn"
          onClick={goPrev}
          disabled={!canGoPrev}
        >
          ‹
        </button>
        <span className="wk-file-preview-office-renderer__page-info">
          {page.total > 0 ? `${page.current + 1} / ${page.total}` : "—"}
        </span>
        <button
          className="wk-file-preview-office-renderer__nav-btn"
          onClick={goNext}
          disabled={!canGoNext}
        >
          ›
        </button>
      </div>
      <div ref={viewportRef} className="wk-file-preview-office-renderer__viewport">
        <canvas
          ref={canvasRef}
          className="wk-file-preview-office-renderer__canvas"
          aria-label={file.name}
        />
      </div>
    </div>
  );
};

export const DocxRenderer: React.FC<BaseRendererProps> = (props) => (
  <OfficeRenderer {...props} format="docx" />
);

export const PptxRenderer: React.FC<BaseRendererProps> = (props) => (
  <OfficeRenderer {...props} format="pptx" />
);

export default OfficeRenderer;
