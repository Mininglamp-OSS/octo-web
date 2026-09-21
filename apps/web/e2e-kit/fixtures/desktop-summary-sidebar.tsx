import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import type { SummaryListItem } from "../../../../packages/dmworksummary/src/types/summary";
import type { ChannelSearchItem } from "../../../../packages/dmworkbase/src/Service/SearchTypes";
import { observeChatLayout, type ChatLayout } from "../../../../packages/dmworkbase/src/Pages/Chat/responsiveLayout";
import { installDesktopPresentation, type DesktopPresentation } from "../../src/client-feature/desktop/presentation";
import enUS from "../../../../packages/dmworksummary/src/i18n/en-US.json";
import zhCN from "../../../../packages/dmworksummary/src/i18n/zh-CN.json";
import "../../../../packages/dmworkbase/src/theme/index.css";
import "../../../../packages/dmworkbase/src/App.css";
import "../../../../packages/dmworkbase/src/Pages/Chat/index.css";
import "../../../../packages/dmworkbase/src/features/channelSearch/channel-search-panel.css";
import "../../../../packages/dmworksummary/src/index.css";
import "../../../../packages/dmworksummary/src/workspace/index.css";
import "../../src/client-feature/desktop/presentation.css";
import "../../src/client-feature/desktop/summary.css";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const params = new URLSearchParams(location.search);
const platform = params.get("platform") ?? "darwin";
const width = Number(params.get("width") ?? 360);
const zoom = Number(params.get("zoom") ?? 1);
const root = document.getElementById("root")!;
const task: SummaryListItem = {
  task_id: 91, task_no: "SUMMARY-91", title: "Sidebar reference",
  summary_mode: 1, trigger_type: 1, status: 3, creator_id: "fixture-user",
  time_range_start: "2026-09-01T00:00:00Z", time_range_end: "2026-09-20T00:00:00Z",
  sources: [{ source_type: 1, source_id: "fixture-channel", source_name: "Project" }],
  participants: [], total_msg_count: 12, creator_name: "Tester",
  origin_channel_id: "fixture-channel", origin_channel_type: 2,
  created_at: "2026-09-20T00:00:00Z", completed_at: "2026-09-20T00:00:00Z",
  current_result_id: 911, referenceable: true,
};

// Install before importing business modules, so their axios instances inherit it.
// Summary rendering, navigation and layout are production code. The optional
// host-preview fixture also substitutes its message renderer and native bridge.
axios.defaults.adapter = async config => {
  const path = new URL(config.url!, location.origin).pathname;
  let data: unknown;
  if (config.method !== "get") throw new Error(`Unexpected fixture mutation: ${path}`);
  if (path.endsWith("/summary-workbench/capabilities")) {
    data = { enabled: !params.has("legacy"), contract_version: "2", max_time_range_days: 90, direct_team_workflow: true };
  } else if (path.endsWith("/summary-templates")) {
    data = { templates: [], custom_template_limit: 30 };
  } else if (path.endsWith("/summaries")) {
    data = { items: [task], total: 1, attention_count: 0, unread_count: 0, pending_invitation_count: 0 };
  } else if (path.endsWith("/summaries/91")) {
    data = {
      ...task, error_message: null,
      result: {
        content: "# Reference\n\nContent remains readable in a narrow preview.\n\n".repeat(20),
        total_msg_count: 12, total_token_used: 100, model_version: "fixture",
        version: 1, generated_at: task.completed_at,
      },
    };
  } else if (path.endsWith("/summary-chat-candidates") || path.endsWith("/versions")) {
    data = [];
  } else {
    throw new Error(`Unexpected fixture request: ${path}`);
  }
  return { data: { code: 0, message: "ok", data }, status: 200, statusText: "OK", headers: {}, config };
};

async function bootstrap() {
  const { I18nProvider, i18n, WKApp } = await import("@octo/base");
  const { default: ChatSummaryPanel } = await import("../../../../packages/dmworksummary/src/components/ChatSummaryPanel");
  const { default: SummaryWorkbenchCreateEntry } = await import("../../../../packages/dmworksummary/src/features/summaryWorkbench/SummaryWorkbenchCreateEntry");
  const { MediaResultGrid } = await import("../../../../packages/dmworkbase/src/features/channelSearch/ChannelSearchResults");
  const HostPreviewFixture = params.has("host-preview")
    ? (await import("./desktop-summary-host-preview")).default : null;
  WKApp.shared.currentSpaceId = "sidebar-fixture";
  WKApp.loginInfo.uid = "fixture-user";
  WKApp.apiClient.config.apiURL = location.origin;
  WKApp.remoteConfig.docsOn = true;
  WKApp.remoteConfig.docsSearchOn = true;
  i18n.registerNamespace("summary", { "en-US": enUS, "zh-CN": zhCN });
  i18n.init({ locale: params.get("locale") === "en-US" ? "en-US" : "zh-CN" });
  document.body.setAttribute("theme-mode", params.get("theme") ?? "light");
  localStorage.setItem("wk-summary-panel-width", String(width));

  const media: ChannelSearchItem[] = Array.from({ length: 12 }, (_, index) => ({
    id: `media-${index}`, messageId: String(index), messageSeq: index + 1,
    senderUid: "fixture-user", timestamp: 1_789_920_000, kind: "image",
    media: { tone: "cool", monthBucket: "September 2026" },
  }));

  function Fixture() {
    const content = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const [layout, setLayout] = useState<ChatLayout>({ panelLayout: "split", navigationCollapsed: false });
    useEffect(() => {
      root.dataset.fixtureState = "ready";
    }, []);
    useEffect(() => {
      if (!content.current) return;
      const observer = observeChatLayout(content.current, setLayout);
      observer.update(open ? "summary" : false);
      return () => observer.dispose();
    }, [open]);
    useEffect(() => {
      if (platform === "web") return;
      const state = (): DesktopPresentation => {
        const headerHeight = (platform === "darwin" ? 52 : 48) / zoom;
        const controlsWidth = (platform === "darwin" ? 96 : 138) / zoom;
        return {
          version: 1, revision: 1, platform: platform === "darwin" ? "darwin" : "win32",
          canFuse: !params.has("fallback"), headerHeight, fallbackHeight: headerHeight,
          topArea: { x: 0, y: 0, width: innerWidth, height: headerHeight },
          controls: params.has("fullscreen") ? [] : [{
            x: platform === "darwin" ? 0 : innerWidth - controlsWidth,
            y: 0, width: controlsWidth, height: headerHeight,
          }],
          focused: true, maximized: false, fullScreen: params.has("fullscreen"),
        };
      };
      let active = true;
      let release: (() => void) | null = null;
      void installDesktopPresentation({
        getDesktopPresentation: async () => state(),
        onDesktopPresentation: callback => {
          const update = () => callback(state());
          window.addEventListener("resize", update);
          return () => window.removeEventListener("resize", update);
        },
      }, root).then(dispose => {
        if (active) release = dispose;
        else dispose?.();
      });
      return () => { active = false; release?.(); };
    }, []);
    return (
      <I18nProvider>
        {params.has("media") ? (
          <div className="wk-channel-search-content" style={{ width, maxWidth: "100%" }}>
            <MediaResultGrid items={media} onLocate={() => undefined} />
          </div>
        ) : HostPreviewFixture ? (
          <HostPreviewFixture width={width} />
        ) : params.has("standalone") ? (
          <main style={{ width, maxWidth: "100%", height: "100%" }}>
            <SummaryWorkbenchCreateEntry channel={{ channelID: "fixture-channel", channelType: 2 }} />
          </main>
        ) : (
          <div
            ref={content}
            className={`wk-chat-content-right${open ? " wk-chat-summary-panel-open" : ""}`}
            data-chat-panel-layout={open ? layout.panelLayout : undefined}
            data-chat-parent-hidden={open && layout.panelLayout === "overlay" || undefined}
            style={{ width: `min(100%, ${width + 432}px)`, marginLeft: "auto", height: "100%", minWidth: 0 }}
          >
            <div className="wk-chat-content-chat">
              <div data-desktop-chrome="header">Conversation</div>
            </div>
            {open && (
              <div className="wk-summary-panel">
                <ChatSummaryPanel
                  visible
                  channel={{ channelID: "fixture-channel", channelType: 2 }}
                  summaryPanelView={params.has("history") ? "history" : "new"}
                  onClose={() => setOpen(false)}
                />
              </div>
            )}
          </div>
        )}
      </I18nProvider>
    );
  }
  createRoot(root).render(<Fixture />);
}

void bootstrap().catch(error => {
  root.dataset.fixtureState = "error";
  root.dataset.fixtureError = error instanceof Error ? error.message : String(error);
});
