import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// #989: 在 IM 顶部搜索里点 bot → 打开资料卡 → 点「发送消息」跳到会话后，
// 搜索弹窗应自动关闭。修前 TabContacts 的 BotDetailModal.onChat 只关名片、
// 没关外层搜索弹窗，因此 hideModal 必须一路从 GlobalSearchPanel 透传到
// TabContacts 并在 onChat 里调用。这里锁死这条契约，防止后续重构悄悄拆掉。

const tabContactsSrc = fs.readFileSync(
  path.join(__dirname, "..", "tab-contacts.tsx"),
  "utf8"
);

const panelSrc = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "features",
    "globalSearch",
    "GlobalSearchPanel.tsx"
  ),
  "utf8"
);

describe("#989 search popup closes on bot 'send message' (source guard)", () => {
  it("TabContactsProps declares hideModal", () => {
    expect(
      /interface TabContactsProps[\s\S]*?hideModal\??:\s*\(\)\s*=>\s*void/.test(
        tabContactsSrc
      ),
      "TabContacts should accept a hideModal prop"
    ).toBe(true);
  });

  it("TabContacts.BotDetailModal.onChat invokes this.props.hideModal", () => {
    const onChatMatch = tabContactsSrc.match(
      /<BotDetailModal[\s\S]*?onChat=\{\(channel\)\s*=>\s*\{([\s\S]*?)\}\}/
    );
    expect(onChatMatch, "BotDetailModal.onChat block should exist").toBeTruthy();
    const body = onChatMatch![1];
    expect(
      /this\.props\.hideModal\?\.\(\)/.test(body),
      "onChat must call hideModal() so the outer search WKModal dismisses"
    ).toBe(true);
  });

  it("GlobalSearchPanel forwards hideModal to TabContacts", () => {
    const match = panelSrc.match(/<TabContacts[\s\S]*?\/>/);
    expect(match, "TabContacts usage should exist in GlobalSearchPanel").toBeTruthy();
    expect(
      /hideModal=\{this\.props\.hideModal\}/.test(match![0]),
      "GlobalSearchPanel must thread hideModal down to TabContacts"
    ).toBe(true);
  });
});
