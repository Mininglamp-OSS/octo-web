import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Channel, ChannelInfo, Subscriber } from "wukongimjssdk";
import WKApp, { ThemeMode } from "../../../../packages/dmworkbase/src/App";
import { MemberRemovalList } from "../../../../packages/dmworkbase/src/Components/Subscribers/memberRemovalList";
import { GroupRole } from "../../../../packages/dmworkbase/src/Service/Const";
import type { IChannelDataSource } from "../../../../packages/dmworkbase/src/Service/DataSource/DataSource";
import { I18nProvider, i18n } from "../../../../packages/dmworkbase/src/i18n";
import { setCurrentImChannelInfoCache } from "../../../../packages/dmworkbase/src/im-runtime/currentChannelRuntime";
import "../../../../packages/dmworkbase/src/theme/index.css";
import "../../../../packages/dmworkbase/src/App.css";
import "../../../../packages/dmworkbase/src/Components/IndexTable/index.css";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en-US" ? "en-US" : "zh-CN";
const dark = params.get("theme") === "dark";
const root = document.getElementById("root")!;
const channel = new Channel("member-removal-fixture", 2);
document.body.setAttribute("theme-mode", dark ? "dark" : "light");
WKApp.config.themeMode = dark ? ThemeMode.dark : ThemeMode.light;
WKApp.loginInfo.uid = "fixture-viewer";
WKApp.shared.currentSpaceId = "fixture-space";
// Never sign in, connect IM, or call a live API from this fixture.
WKApp.apiClient.config.apiURL = "http://127.0.0.1:9";
WKApp.shared.avatarUser = () => "/logo192.png";
i18n.init({ locale });

const members = Array.from({ length: 55 }, (_, index) => {
  const bot = index < 2;
  const row = new Subscriber();
  row.uid = bot ? `fixture-${index}@bot` : `fixture-${index}`;
  row.channel = channel;
  row.name = index === 0
    ? "跨组织研发协同与需求分析专用智能助手 Very long owned assistant name"
    : bot ? "My assistant" : `Member ${index}`;
  row.role = GroupRole.normal;
  row.status = 1;
  row.orgData = {
    bot_owned_by_me: bot,
    home_space_id: "fixture-space",
  };
  const info = new ChannelInfo();
  info.channel = new Channel(row.uid, 1);
  info.title = row.name;
  info.orgData = { robot: bot ? 1 : 0 };
  setCurrentImChannelInfoCache(info);
  return row;
});
let failNextPage = params.has("error");
const subscribers: IChannelDataSource["subscribers"] = async (_channel, request) => {
  if (request.page === 2 && failNextPage) {
    failNextPage = false;
    throw new Error("Fixture: page 2 temporarily unavailable");
  }
  const keyword = request.keyword?.trim().toLowerCase() ?? "";
  const matches = keyword
    ? members.filter(row => row.name.toLowerCase().includes(keyword))
    : members;
  return matches.slice((request.page - 1) * request.limit, request.page * request.limit);
};
WKApp.dataSource.channelDataSource = { subscribers } as IChannelDataSource;

function Fixture() {
  const [selected, setSelected] = useState<Subscriber[]>([]);
  return (
    <I18nProvider>
      <main style={{
        width: Number(params.get("width") ?? 320), maxWidth: "100%",
        height: "100%", display: "flex", flexDirection: "column",
        background: "var(--wk-bg-surface)", color: "var(--wk-text-primary)",
      }}>
        <header style={{ padding: "var(--wk-sp-3)", flex: "0 0 auto" }}>
          {locale === "en-US" ? "Remove members" : "移出成员"}
        </header>
        <section style={{ flex: 1, minHeight: 0 }}>
          <MemberRemovalList channel={channel} viewerUid="fixture-viewer"
            viewerRole={params.has("ordinary") ? GroupRole.normal : GroupRole.owner}
            onSelectionChange={setSelected}
            createLocalSearch={rows => keyword => rows.filter(
              row => row.name.toLowerCase().includes(keyword.toLowerCase())
            )}
          />
        </section>
        <output aria-label="Selected members" style={{ padding: "var(--wk-sp-3)", flex: "0 0 auto" }}>
          {selected.length} selected
        </output>
      </main>
    </I18nProvider>
  );
}

createRoot(root).render(<Fixture />);
