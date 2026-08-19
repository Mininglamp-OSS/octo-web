import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// #1452 review P2-2:为新增的两个命令式埋点 subchannel_opened / channel_search_query 钉死覆盖点。
// 这两个事件所在组件(ChatContentPage / ChannelSearchPanel / ConversationList)挂载依赖极重的
// transitive 图,headless 渲染成本过高,故沿用本仓既有做法(见 Components/GlobalSearch/__tests__/
// isActive.test.tsx)——在源码层锁定关键行,防止后续改动悄悄把覆盖点改没(正是 P1-1 那类回归)。

const base = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(base, rel), "utf8");

const chatSrc = read("Pages/Chat/index.tsx");
const convListSrc = read("Components/ConversationList/index.tsx");
const searchPanelSrc = read("features/channelSearch/ChannelSearchPanel.tsx");
const conversationSrc = read("Components/Conversation/index.tsx");

describe("subchannel_opened — 覆盖点(P1-1)", () => {
  it("componentDidMount 以子区频道挂载时命令式发(入口:列表/预览/深链)", () => {
    // 父群 channel_id + 子区 short_id 就位才发,两者来自 parseThreadChannelId。
    expect(chatSrc).toMatch(
      /const parsed = parseThreadChannelId\(channel\.channelID\)/
    );
    expect(chatSrc).toMatch(
      /if \(parentGroupNo && parsed\?\.shortId\)\s*\{[\s\S]{0,160}Dap\.shared\.track\(\s*["']subchannel_opened["']/
    );
    expect(chatSrc).toMatch(
      /subchannel_opened["'],\s*\{[\s\S]{0,120}channel_id:\s*parentGroupNo,[\s\S]{0,80}subchannel_id:\s*parsed\.shortId/
    );
  });

  it("componentDidUpdate 保留页内子区选择入口(activeThread 身份变化)", () => {
    expect(chatSrc).toMatch(
      /curThread\.channel_id !== prevState\.activeThread\?\.channel_id[\s\S]{0,160}Dap\.shared\.track\(\s*["']subchannel_opened["']/
    );
  });

  it("会话列表子区行不再发 channel_opened(与 subchannel_opened 分区,不重叠)", () => {
    // compact 行 + flat 行两处都按 isThread 门控 data-track。
    const gated = convListSrc.match(
      /data-track=\{isThread \? undefined : "channel_opened"\}/g
    );
    expect(gated).toHaveLength(2);
    // 不得再有无条件的 channel_opened DOM 标注。
    expect(convListSrc).not.toMatch(/data-track="channel_opened"/);
  });
});

describe("channel_search_query — 覆盖点(P2-1/P2-3)", () => {
  it("首页检索且带 keyword 或有效 filter 才发(空浏览 tab 切换不误发)", () => {
    expect(searchPanelSrc).toMatch(
      /if \(keyword\.trim\(\)\.length === 0 && !hasEffectiveFilters\(filters\)\)\s*return;/
    );
    expect(searchPanelSrc).toMatch(
      /Dap\.shared\.track\(\s*["']channel_search_query["']/
    );
  });

  it("channel_id 经 stripSpacePrefix 归一(与后端 _search_ 对齐,P2-3)", () => {
    expect(searchPanelSrc).toMatch(
      /channel_search_query["'],\s*\{[\s\S]{0,80}channel_id:\s*stripSpacePrefix\(channel\.channelID\)/
    );
  });
});

describe("octo_assistant_queried — Space 前缀归一(P1-2)", () => {
  it("botUid 经 stripSpacePrefix 再比对 octoAssistantUids", () => {
    expect(conversationSrc).toMatch(
      /const botUid = stripSpacePrefix\(c\.channelID\)/
    );
  });
});
