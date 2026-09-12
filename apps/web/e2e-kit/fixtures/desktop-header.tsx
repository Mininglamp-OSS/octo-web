import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FilePreviewHeader } from "../../../../packages/dmworkbase/src/Components/FilePreviewPanel/FilePreviewHeader";
import "../../../../packages/dmworkbase/src/theme/index.css";
import "../../../../packages/dmworkbase/src/App.css";
import "../../../../packages/dmworkbase/src/Components/FilePreviewPanel/index.css";
import "../../src/client-communication/desktop-presentation.css";
import { installDesktopPresentation, type DesktopPresentation } from "../../src/client-communication/desktopPresentation";
import type { OctoBuddyCommunicationBridge } from "../../src/client-communication/hostBridge";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const params = new URLSearchParams(location.search);
const platform = params.get("platform") ?? "win32";
const panelWidth = Number(params.get("width") ?? 432);
const zoom = Number(params.get("zoom") ?? 1);
const headerHeight = (platform === "darwin" ? 52 : 48) / zoom;
const controlsWidth = (platform === "darwin" ? 96 : 138) / zoom;
const root = document.getElementById("root")!;
const file = {
  name: "\u9879\u76ee\u9700\u6c42\u8be6\u7ec6\u8bbe\u8ba1\u6587\u6863".repeat(5) + ".html",
  extension: "html",
  url: "/fixture.html",
};

function HeaderFixture() {
  const [action, setAction] = useState("");
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  useEffect(() => {
    if (platform === "web") return;
    const state = (): DesktopPresentation => ({
      version: 1, revision: 1, platform: platform === "darwin" ? "darwin" : "win32",
      canFuse: true, headerHeight, fallbackHeight: headerHeight,
      topArea: { x: 0, y: 0, width: innerWidth, height: headerHeight },
      controls: [{ x: platform === "darwin" ? 0 : innerWidth - controlsWidth, y: 0, width: controlsWidth, height: headerHeight }],
      focused: true, maximized: false, fullScreen: false,
    });
    const bridge = {
      getDesktopPresentation: async () => state(),
      onDesktopPresentation: () => () => {},
    } as unknown as OctoBuddyCommunicationBridge;
    let active = true;
    let release: (() => void) | null = null;
    void installDesktopPresentation(bridge, root).then(dispose => {
      if (active) release = dispose;
      else dispose?.();
    });
    return () => { active = false; release?.(); };
  }, []);
  return (
    <>
      <div className="wk-chat-content-right wk-chat-filepreview-open">
      <div className="wk-file-preview-panel" style={{ width: panelWidth }}>
        <FilePreviewHeader
          file={file}
          conversationFiles={[{ ...file, id: "fixture" }]}
          onClose={() => setAction("close")}
          onDownload={() => setAction("download")}
          showOpenExternal
          onOpenExternal={() => setAction("external")}
          onReply={() => setAction("reply")}
          showBackButton
          onBack={() => setAction("back")}
          showTocButton
          onTocToggle={() => setAction("toc")}
          onFilePanelToggle={() => setAction("files")}
          showViewToggle
          viewMode={viewMode}
          onViewModeChange={mode => { setViewMode(mode); setAction(mode); }}
        />
      </div>
      </div>
      <output data-testid="action">{action}</output>
    </>
  );
}

createRoot(root).render(<HeaderFixture />);
