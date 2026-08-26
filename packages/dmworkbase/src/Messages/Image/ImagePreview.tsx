import React from "react";
import { Toast } from "@douyinfe/semi-ui";
import { Copy, Download, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import Lightbox, {
  isImageSlide,
  useLightboxState,
} from "yet-another-react-lightbox";
import type { Slide, ZoomRef } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { t } from "../../i18n";
import { copyImageToClipboard } from "../../Utils/clipboard";
import { downloadFile } from "../../Utils/download";
import "./index.css";

interface ImagePreviewToolbarProps {
  zoom: ZoomRef;
  filename?: string;
  onReset: () => void;
  onRotate: () => void;
}

export function ImagePreviewToolbar({
  zoom,
  filename,
  onReset,
  onRotate,
}: ImagePreviewToolbarProps) {
  const { currentSlide } = useLightboxState();
  const [copying, setCopying] = React.useState(false);
  const src =
    currentSlide && isImageSlide(currentSlide) ? currentSlide.src : "";

  const handleCopy = async () => {
    if (!src) return;
    setCopying(true);
    try {
      await copyImageToClipboard(src);
      Toast.success(t("base.module.contextMenus.copyImageSuccess"));
    } catch (error) {
      Toast.warning(
        error instanceof Error
          ? error.message
          : t("base.module.contextMenus.copyFailed")
      );
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="wk-image-preview-toolbar">
      <button
        type="button"
        aria-label={t("base.filePreview.pdf.zoomOut")}
        title={t("base.filePreview.pdf.zoomOut")}
        disabled={zoom.disabled || zoom.zoom <= zoom.minZoom}
        onClick={zoom.zoomOut}
      >
        <ZoomOut size={19} />
      </button>
      <button
        type="button"
        className="wk-image-preview-toolbar-reset"
        aria-label={t("base.filePreview.pdf.actualSize")}
        title={t("base.filePreview.pdf.actualSize")}
        onClick={() => {
          zoom.changeZoom(1);
          onReset();
        }}
      >
        1:1
      </button>
      <button
        type="button"
        aria-label={t("base.filePreview.pdf.zoomIn")}
        title={t("base.filePreview.pdf.zoomIn")}
        disabled={zoom.disabled || zoom.zoom >= zoom.maxZoom}
        onClick={zoom.zoomIn}
      >
        <ZoomIn size={19} />
      </button>
      <span className="wk-image-preview-toolbar-divider" />
      <button
        type="button"
        aria-label={t("base.message.imagePreview.rotate")}
        title={t("base.message.imagePreview.rotate")}
        onClick={() => {
          zoom.changeZoom(1);
          onRotate();
        }}
      >
        <RotateCw size={19} />
      </button>
      <span className="wk-image-preview-toolbar-divider" />
      <button
        type="button"
        aria-label={t("base.module.contextMenus.copyImage")}
        title={t("base.module.contextMenus.copyImage")}
        disabled={!src || copying}
        onClick={handleCopy}
      >
        <Copy size={19} />
      </button>
      <span className="wk-image-preview-toolbar-divider" />
      <button
        type="button"
        aria-label={t("base.filePreview.download")}
        title={t("base.filePreview.download")}
        disabled={!src}
        onClick={() => src && downloadFile(src, filename || "image.png")}
      >
        <Download size={19} />
      </button>
    </div>
  );
}

interface ImagePreviewLightboxProps {
  open: boolean;
  close: () => void;
  slides: readonly Slide[];
  index?: number;
  filename?: string;
  isMulti?: boolean;
}

export function ImagePreviewLightbox({
  open,
  close,
  slides,
  index,
  filename,
  isMulti,
}: ImagePreviewLightboxProps) {
  const [rotation, setRotation] = React.useState(0);
  const resetRotation = () => setRotation(0);

  return (
    <Lightbox
      className="wk-image-preview"
      open={open}
      close={() => {
        resetRotation();
        close();
      }}
      slides={slides}
      index={index}
      plugins={[Zoom]}
      labels={{
        Close: t("base.common.close"),
        "Zoom in": t("base.filePreview.pdf.zoomIn"),
        "Zoom out": t("base.filePreview.pdf.zoomOut"),
      }}
      toolbar={{ buttons: ["zoom", "close"] }}
      zoom={{
        minZoom: 0.25,
        maxZoomPixelRatio: 4,
        zoomInMultiplier: 1.25,
        scrollToZoom: true,
      }}
      carousel={{
        finite: true,
        imageProps: {
          style: {
            maxWidth: rotation % 180 ? "100cqh" : "100%",
            maxHeight: rotation % 180 ? "100cqw" : "100%",
          },
        },
      }}
      controller={{ closeOnBackdropClick: true }}
      on={{ entering: resetRotation, view: resetRotation }}
      styles={{
        root: { "--yarl__image_preview_rotation": `${rotation}deg` },
      }}
      render={{
        buttonPrev: isMulti ? undefined : () => null,
        buttonNext: isMulti ? undefined : () => null,
        buttonZoom: (zoom) => (
          <ImagePreviewToolbar
            zoom={zoom}
            filename={filename}
            onReset={resetRotation}
            onRotate={() => setRotation((value) => (value + 90) % 360)}
          />
        ),
        iconClose: () => <X size={22} />,
      }}
    />
  );
}
