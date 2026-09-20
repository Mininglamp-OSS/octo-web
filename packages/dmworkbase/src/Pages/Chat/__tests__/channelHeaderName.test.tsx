import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WKSDK, { Channel, ChannelInfo } from "wukongimjssdk";
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));
import { ChatContentPage } from "../index";
import { i18n } from "../../../i18n";
import zhCN from "../../../i18n/locales/zh-CN.json";
import enUS from "../../../i18n/locales/en-US.json";

afterEach(() => vi.restoreAllMocks());

describe("conversation header names", () => {
  it("renders title-only host data and preserves remarks", () => {
    const channel = new Channel("peer", 1);
    const page: any = new ChatContentPage({ channel });
    const info = Object.assign(new ChannelInfo(), { channel, title: "Contact name", orgData: {} });
    expect(page.renderConversationHeaderTitle(channel, info)).toBe("Contact name");
    info.orgData = { displayName: "Display", remark: "My remark" };
    expect(page.renderConversationHeaderTitle(channel, info)).toBe("My remark");
  });

  it.each(["zh-CN", "en-US"] as const)("renders loading/unavailable states in %s without a UID", (locale) => {
    i18n.registerNamespace("base", { "zh-CN": zhCN, "en-US": enUS });
    i18n.setLocale(locale, { persist: false });
    const channel = new Channel("deadbeefdeadbeefdeadbeefdeadbeef", 1);
    const page: any = new ChatContentPage({ channel });
    const loading = page.renderConversationHeaderTitle(channel, undefined);
    expect(loading).toBe(locale === "zh-CN" ? "名称加载中..." : "Loading name...");
    page.state.channelInfoLoading = false;
    const unavailable = page.renderConversationHeaderTitle(channel, undefined);
    expect(unavailable).toBe(locale === "zh-CN" ? "名称暂不可用" : "Name unavailable");
    expect(unavailable).not.toContain(channel.channelID);
  });

  it("renders a thread's title fallback alongside its parent", () => {
    const channel = new Channel("group____thread", 5);
    const page: any = new ChatContentPage({ channel });
    const info = Object.assign(new ChannelInfo(), { channel, title: "Thread title", orgData: {} });
    const title = page.renderConversationHeaderTitle(channel, info, "group");
    expect(renderToStaticMarkup(<>{title}</>)).toContain("Thread title");
  });

  it("does not start network requests from render", () => {
    const channel = new Channel("empty", 1);
    const fetch = vi.spyOn(WKSDK.shared().channelManager, "fetchChannelInfo");
    const page = new ChatContentPage({ channel });
    page.render();
    page.render();
    expect(fetch).not.toHaveBeenCalled();
  });
});
