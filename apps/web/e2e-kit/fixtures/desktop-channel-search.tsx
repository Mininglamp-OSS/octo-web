import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Channel } from "wukongimjssdk";
import {
  observeChatLayout,
  type ChatLayout,
} from "../../../../packages/dmworkbase/src/Pages/Chat/responsiveLayout";
import type { ChannelSearchDataSource } from "../../../../packages/dmworkbase/src/Service/SearchTypes";
import "../../../../packages/dmworkbase/src/theme/index.css";
import "../../../../packages/dmworkbase/src/App.css";
import "../../../../packages/dmworkbase/src/Pages/Chat/index.css";
import "../../src/client-communication/index.css";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const params = new URLSearchParams(location.search);
const root = document.getElementById("root")!;
const avatar = new URL(
  "../../../../packages/dmworkbase/src/Components/ChannelSearch/assets/figma-avatar-liubo.png",
  import.meta.url,
).href;
const dataSource: ChannelSearchDataSource = {
  getSenders: () => [{ uid: "fixture-user", name: "Fixture sender", avatarUrl: avatar }],
  getSender: uid => ({ uid, name: "Fixture sender", avatarUrl: avatar }),
  searchMessages: async query => ({
    hasMore: false,
    items: query.tab === "media" ? [] : [{
      id: "fixture-file", messageId: "1001", messageSeq: 1,
      senderUid: "fixture-user", timestamp: 1_789_920_000, kind: "file",
      file: {
        name: "design-review-search-and-message-history-long-filename.pdf",
        extension: "pdf", size: 2048,
      },
    }],
  }),
};

async function bootstrap() {
  const { I18nProvider, i18n, WKApp, WKLayout } = await import("@octo/base");
  const { default: ChannelSearchPanel } = await import("../../../../packages/dmworkbase/src/features/channelSearch/ChannelSearchPanel");
  WKApp.shared.currentSpaceId = "search-layout-fixture";
  WKApp.loginInfo.uid = "fixture-user";
  WKApp.apiClient.config.apiURL = "http://127.0.0.1:9";
  i18n.init({ locale: params.get("locale") === "en-US" ? "en-US" : "zh-CN" });
  document.body.setAttribute("theme-mode", params.get("theme") ?? "light");

  function Fixture() {
    const content = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const [layout, setLayout] = useState<ChatLayout>({ panelLayout: "split", navigationCollapsed: false });
    const compact = params.has("compact");
    useEffect(() => {
      if (!content.current) return;
      const observer = observeChatLayout(content.current, setLayout);
      observer.update(open ? compact ? "thread" : "search" : false);
      root.dataset.fixtureState = "ready";
      return () => observer.dispose();
    }, [open, compact]);
    return (
      <div ref={content}
        className={`wk-chat-content-right${open ? compact ? " wk-chat-threadpanel-open wk-chat-threadpanel-compact" : " wk-chat-channel-search-open" : ""}`}
        data-chat-panel-layout={open ? layout.panelLayout : undefined}
        data-chat-parent-hidden={open && layout.panelLayout === "overlay" || undefined}
        style={{ width: "100%", height: "100%", minWidth: 0 }}
      >
        <div className="wk-chat-content-chat">
          <button onClick={() => setOpen(true)}>Open search</button>
          <input aria-label="Conversation draft" />
        </div>
        {open && (compact ? <div className="wk-thread-panel">Compact thread</div> : (
          <div className="wk-chat-channel-search-panel">
            <ChannelSearchPanel channel={new Channel("fixture-channel", 2)}
              onClose={() => setOpen(false)} dataSource={dataSource}
              initialState={params.has("filtered") ? {
                keyword: "design",
                filters: { senderUids: ["fixture-user"], sort: "time_asc", startAt: 1, endAt: 1_789_920_000 },
              } : undefined}
            />
          </div>
        ))}
      </div>
    );
  }
  createRoot(root).render(
    <I18nProvider>
      {params.has("client-shell") ? (
        <div className="communication-shell communication-shell--conversation">
          <WKLayout embedded
            contentLeft={<div>Web conversation list</div>}
            contentRight={<div />}
            onRightContext={context => context.replaceToRoot(<Fixture />)}
          />
        </div>
      ) : <Fixture />}
    </I18nProvider>,
  );
}

void bootstrap().catch(error => {
  root.dataset.fixtureState = "error";
  root.dataset.fixtureError = error instanceof Error ? error.message : String(error);
});
