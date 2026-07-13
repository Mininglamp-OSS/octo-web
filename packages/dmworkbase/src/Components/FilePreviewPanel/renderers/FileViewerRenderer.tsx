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
        filename={file.name}
        name={file.name}
        size={file.size}
        options={{
          preset: [officePreset, allPreset],
          rendererMode: "replace",
          theme: "system",
          styleIsolation: "scoped",
          toolbar: { position: "bottom-right" },
          spreadsheet: {
            worker: "main",
            resizableColumns: false,
            resizableRows: false,
          },
        }}
        onEvent={handleEvent}
      />
    </div>
  );
};

export default FileViewerRenderer;
