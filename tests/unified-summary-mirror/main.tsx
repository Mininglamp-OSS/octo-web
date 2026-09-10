import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, i18n, WKApp as BaseWKApp } from "@octo/base";
import APIClient from "@octo/base/src/Service/APIClient";
import WKApp from "@octo/base/src/App";
import { Channel } from "wukongimjssdk";
import { initializeSummaryWebRuntime } from "../../packages/dmworksummary/src/runtime/lifecycle";
import SummaryWorkspace from "../../packages/dmworksummary/src/workspace/SummaryWorkspace";
import type { SummaryWorkspaceRoute } from "../../packages/dmworksummary/src/workspace/types";
import "@octo/base/src/theme/index.css";
import "@octo/base/src/Pages/Chat/index.css";
import "./style.css";

// Only synthetic fixture identity, never browser-stored credentials.
APIClient.shared.config.apiURL = "/api/v1/";
APIClient.shared.config.tokenCallback = () => "fixture-owner";
WKApp.shared.currentSpaceId = "unified-fixture";
WKApp.loginInfo.uid = "owner";
WKApp.loginInfo.token = "fixture-owner";
const params = new URLSearchParams(window.location.search);
i18n.setLocale(params.get("lang") === "en-US" ? "en-US" : "zh-CN");
if (params.get("theme") === "dark") document.body.setAttribute("theme-mode", "dark");

// The production bootstrap, not a fixture-local re-registration: i18n namespace,
// legacy routes, the attention runtime, candidate search AND the chat extension
// (channel-header star button + the chat summary panel endpoint). Both mounts below
// therefore exercise the same registrations the real Web app installs.
initializeSummaryWebRuntime();

const CHANNEL = new Channel("group1", 2);

/**
 * Chat mount — reproduces the IM chat page's contract around the summary sidebar:
 * the real star button comes from the channelHeaderRightItems endpoint, the
 * `wk:toggle-summary-panel` bus event opens the panel with the view the button
 * chose, and the panel itself is rendered through the chatSummaryPanel endpoint
 * inside `.wk-chat-content-right > .wk-summary-panel`. Nothing about the summary
 * sidebar is re-implemented here; only the surrounding chat page is faked.
 */
function ChatMount() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"history" | "new">("history");
  const headerItems = useMemo(
    () => WKApp.endpoints.channelHeaderRightItems(CHANNEL),
    []
  );

  useEffect(() => {
    const onToggle = (data: any) => {
      if (
        data?.channelId !== CHANNEL.channelID ||
        data?.channelType !== CHANNEL.channelType
      )
        return;
      setView(data.summaryPanelView === "new" ? "new" : "history");
      setOpen((current) => (data.forceOpen ? true : !current));
    };
    BaseWKApp.mittBus.on("wk:toggle-summary-panel", onToggle);
    return () => BaseWKApp.mittBus.off("wk:toggle-summary-panel", onToggle);
  }, []);

  return (
    <div className="wk-chat-content">
      <div
        className={`wk-chat-content-right${
          open ? " wk-chat-summary-panel-open" : ""
        }`}
      >
        <div className="wk-chat-content-chat mirror-chat">
          <header className="mirror-chat__header">
            <span className="mirror-chat__title">Project Alpha 发布群</span>
            <div className="mirror-chat__actions" data-testid="mirror-chat-actions">
              {headerItems.map((item, index) => (
                <React.Fragment key={index}>{item}</React.Fragment>
              ))}
            </div>
          </header>
          <div className="mirror-chat__body">
            聊天区占位。右上角的 ✨ 是真实的总结入口按钮：有历史总结时打开列表，
            没有时直接进创建。
          </div>
        </div>
        {open ? (
          <div className="wk-summary-panel">
            {WKApp.endpoints.chatSummaryPanel(CHANNEL, () => setOpen(false), view)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Workspace mount — the unified entry, owning list / create / detail / schedules. */
function WorkspaceMount() {
  const initial = params.get("task");
  const [route, setRoute] = useState<SummaryWorkspaceRoute>(
    initial ? { view: "detail", taskId: Number(initial) } : { view: "list" }
  );
  return <SummaryWorkspace route={route} onRouteChange={setRoute} />;
}

function Fixture() {
  const [mount, setMount] = useState(
    params.get("mount") === "chat" ? "chat" : "workspace"
  );
  const switchTo = useCallback((next: "workspace" | "chat") => {
    const query = new URLSearchParams(window.location.search);
    query.set("mount", next);
    window.history.replaceState({}, "", `${window.location.pathname}?${query}`);
    setMount(next);
  }, []);

  return (
    <div className="mirror-shell">
      <nav className="mirror-shell__tabs">
        <button
          type="button"
          data-testid="mirror-mount-workspace"
          className={mount === "workspace" ? "is-active" : ""}
          onClick={() => switchTo("workspace")}
        >
          总结工作区
        </button>
        <button
          type="button"
          data-testid="mirror-mount-chat"
          className={mount === "chat" ? "is-active" : ""}
          onClick={() => switchTo("chat")}
        >
          聊天 + 侧栏
        </button>
      </nav>
      <div className="mirror-shell__mount">
        {mount === "chat" ? <ChatMount /> : <WorkspaceMount />}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<I18nProvider><Fixture /></I18nProvider>);
