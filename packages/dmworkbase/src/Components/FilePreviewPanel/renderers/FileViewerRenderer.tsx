import React from "react";
import FileViewer, { type ViewerEvent } from "@file-viewer/react-legacy";
import officePreset from "@file-viewer/preset-office";
import allPreset from "@file-viewer/preset-all";
import { BaseRendererProps } from "../types";
import { isFileTooLarge } from "../config";
import FileTooLarge from "./FileTooLarge";
import "./FileViewerRenderer.css";

/** Unified file-viewer renderer for every supported file format. */
const FileViewerRenderer: React.FC<BaseRendererProps> = ({ file, onError }) => {
  if (file.size && isFileTooLarge(file.size)) {
    return <FileTooLarge fileName={file.name} fileSize={file.size} fileUrl={file.url} />;
  }

  // WPS Office extensions are internally Microsoft Office formats.
  // Remap to the equivalent Office extension so file-viewer selects
  // the correct renderer (it dispatches by filename extension).
  const WPS_EXT_MAP: Record<string, string> = {
    wps: "docx",
    et: "xlsx",
    dps: "pptx",
  };
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.substring(dot + 1).toLowerCase() : "";
  const mappedExt = WPS_EXT_MAP[ext];
  const viewerFilename = mappedExt
    ? file.name.substring(0, dot + 1) + mappedExt
    : file.name;

  const handleEvent = (event: ViewerEvent) => {
    if (event.type === "error") {
      const message = event.error instanceof Error
        ? event.error.message
        : String(event.error ?? "Unable to render file");
      onError?.(message);
    }
  };

  return (
    <div className="wk-file-preview-file-viewer">
      <FileViewer
        url={file.url}
        filename={viewerFilename}
        name={viewerFilename}
        size={file.size}
        options={{
          preset: [officePreset, allPreset],
          rendererMode: "replace",
          theme: "system",
          styleIsolation: "scoped",
          toolbar: { position: "bottom-right" },
          spreadsheet: {
            workerUrl: "/vendor/xlsx/sheet.worker.js",
          },
        }}
        onEvent={handleEvent}
      />
    </div>
  );
};

export default FileViewerRenderer;
