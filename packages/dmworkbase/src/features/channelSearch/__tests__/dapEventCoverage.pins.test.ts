import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// #1452 review P2-2:为新增的命令式埋点钉死覆盖点。
// subchannel_opened 的发点决策已抽成纯函数 subchannelOpenTracking.ts,行为(两入口/去重/strip)由
// Service/__tests__/subchannelOpenTracking.test.ts 直接单测(R10 P2-3,替代原先脆弱的源码正则钉);
// 这里只保留无法脱离 JSX 的源码层门控断言:channel_opened 已从 data-track 改命令式,须钉住
// 会话列表不再有声明式 data-track、且两处 onClick 都接了 _trackChannelOpened(payload 决策/is_ai
// 由 Service/__tests__/channelOpenedTracking.test.ts 单测)。
// channel_search_query / octo_assistant_queried 所在组件挂载依赖极重的 transitive 图,headless
// 渲染成本过高,故沿用本仓既有做法(见 Components/GlobalSearch/__tests__/isActive.test.tsx)——
// 在源码层锁定关键行,防止后续改动悄悄把覆盖点改没。

const base = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(base, rel), "utf8");

const convListSrc = read("Components/ConversationList/index.tsx");
const searchPanelSrc = read("features/channelSearch/ChannelSearchPanel.tsx");
const conversationSrc = read("Components/Conversation/index.tsx");

describe("channel_opened — 会话列表命令式采集(原 data-track 改命令式)", () => {
  it("会话行不再用 data-track 声明式发 channel_opened(compact + flat 均已移除,含旧 isThread 门控写法)", () => {
    expect(convListSrc).not.toMatch(
      /data-track=\{isThread \? undefined : "channel_opened"\}/
    );
    expect(convListSrc).not.toMatch(/data-track="channel_opened"/);
  });

  it("改由两处会话行 onClick 命令式发(payload 决策见 channelOpenedTracking 单测)", () => {
    // 命令式发点集中在 _trackChannelOpened,内部 Dap.shared.track('channel_opened', ...)
    expect(convListSrc).toMatch(
      /Dap\.shared\.track\(\s*["']channel_opened["']/
    );
    // compact + flat 两处 onClick 都需调用;漏一处则该路径静默不再采集
    const calls = convListSrc.match(/this\._trackChannelOpened\(conversationWrap\)/g);
    expect(calls).toHaveLength(2);
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
