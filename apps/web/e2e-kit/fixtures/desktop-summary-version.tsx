import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, i18n } from "@octo/base";
import SummaryVersionPanel from "../../../../packages/dmworksummary/src/components/SummaryVersionPanel";
import type { SummaryVersionItem } from "../../../../packages/dmworksummary/src/types/summary";
import enUS from "../../../../packages/dmworksummary/src/i18n/en-US.json";
import zhCN from "../../../../packages/dmworksummary/src/i18n/zh-CN.json";
import "../../../../packages/dmworkbase/src/theme/index.css";
import "../../../../packages/dmworkbase/src/App.css";
import "../../../../packages/dmworksummary/src/index.css";
import "../../../../packages/dmworksummary/src/workspace/index.css";
import "../../src/client-feature/desktop/presentation.css";
import "../../src/client-summary/desktop-summary.css";
import { installDesktopPresentation, type DesktopPresentation } from "../../src/client-feature/desktop/presentation";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const params = new URLSearchParams(location.search);
const platform = params.get("platform") ?? "win32";
const zoom = Number(params.get("zoom") ?? 1);
const fullScreen = params.has("fullscreen");
const canFuse = !params.has("fallback");
const root = document.getElementById("root")!;
i18n.registerNamespace("summary", { "en-US": enUS, "zh-CN": zhCN });
i18n.init({ locale: params.get("locale") === "zh-CN" ? "zh-CN" : "en-US" });

const versions: SummaryVersionItem[] = Array.from({ length: 12 }, (_, index) => ({
  result_id: index + 1,
  version: index + 1,
  operation_type: "generate",
  generated_at: "2026-09-01T00:00:00Z",
}));

function VersionFixture() {
  const [open, setOpen] = useState(true);
  const [action, setAction] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (platform === "web") return;
    const state = (): DesktopPresentation => {
      const headerHeight = (platform === "darwin" ? 52 : 48) / zoom;
      const controlsWidth = (platform === "darwin" ? 96 : 138) / zoom;
      return {
        version: 1, revision: 1, platform: platform === "darwin" ? "darwin" : "win32",
        canFuse, headerHeight, fallbackHeight: headerHeight,
        topArea: { x: 0, y: 0, width: innerWidth, height: headerHeight },
        controls: fullScreen ? [] : [{
          x: platform === "darwin" ? 0 : innerWidth - controlsWidth,
          y: 0, width: controlsWidth, height: headerHeight,
        }],
        focused: true, maximized: false, fullScreen,
      };
    };
    let active = true;
    let release: (() => void) | null = null;
    void installDesktopPresentation({
      getDesktopPresentation: async () => state(),
      onDesktopPresentation: () => () => {},
    }, root).then(dispose => {
      if (active) release = dispose;
      else dispose?.();
    });
    return () => { active = false; release?.(); };
  }, []);

  return (
    <I18nProvider>
      <div className="summary-workspace summary-workspace--detail">
        <aside className="summary-workspace__list" />
        <main className="summary-workspace__content" data-desktop-chrome="surface">
          <div className="summary-workspace__page">
            <div className="summary-detail-page">
              <div className="summary-detail-layout">
                <div className="summary-detail-content-wrapper">
                  <div className="summary-detail-title-row" data-desktop-chrome="header">
                    <button onClick={() => setOpen(true)}>Open versions</button>
                  </div>
                </div>
                <SummaryVersionPanel
                  open={open}
                  versions={versions}
                  currentVersion={12}
                  selectedResultId={selected}
                  restoringResultId={null}
                  canRestore
                  onClose={() => { setOpen(false); setAction("close"); }}
                  onSelect={version => { setSelected(version.result_id); setAction("select"); }}
                  onRestore={() => setAction("restore")}
                />
              </div>
            </div>
          </div>
        </main>
      </div>
      <output data-testid="action">{action}</output>
    </I18nProvider>
  );
}

createRoot(root).render(<VersionFixture />);
