import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import WKSDK, { Channel, ChannelInfo } from "wukongimjssdk";
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));
import { ChatContentPage } from "../index";
import { i18n } from "../../../i18n";
import zhCN from "../../../i18n/locales/zh-CN.json";
import enUS from "../../../i18n/locales/en-US.json";
import { WorkspaceGroupProvider } from "../../../features/workspaceGroup/WorkspaceGroupProvider";
import type { WorkspaceGroupHost } from "../../../features/workspaceGroup/contract";

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

  it("preserves recovered names and remarks without a workspace entry on standalone Web", () => {
    const channel = new Channel("group", 2);
    const page = new ChatContentPage({ channel });
    const info = Object.assign(new ChannelInfo(), { channel, title: "Recovered group", orgData: {} });
    const markup = () => renderToStaticMarkup(
      <>{page["renderConversationHeaderTitle"](channel, info, undefined)}</>
    );
    expect(markup()).toBe("Recovered group");
    info.orgData = { displayName: "Group display", remark: "My group remark" };
    expect(markup()).toBe("My group remark");
  });

  it.each(["zh-CN", "en-US"] as const)("preserves group loading/unavailable names in %s", (locale) => {
    i18n.registerNamespace("base", { "zh-CN": zhCN, "en-US": enUS });
    i18n.setLocale(locale, { persist: false });
    const channel = new Channel("group-without-name", 2);
    const page = new ChatContentPage({ channel });
    const markup = () => renderToStaticMarkup(
      <>{page["renderConversationHeaderTitle"](channel, undefined, undefined)}</>
    );
    expect(markup()).toBe(locale === "zh-CN" ? "名称加载中..." : "Loading name...");
    page.state.channelInfoLoading = false;
    expect(markup()).toBe(locale === "zh-CN" ? "名称暂不可用" : "Name unavailable");
  });

  it("keeps the recovered group name beside the Client workspace entry", async () => {
    i18n.registerNamespace("base", { "zh-CN": zhCN, "en-US": enUS });
    i18n.setLocale("en-US", { persist: false });
    const channel = new Channel("group", 2);
    const page = new ChatContentPage({ channel });
    const info = Object.assign(new ChannelInfo(), { channel, title: "Recovered group", orgData: {} });
    const host: WorkspaceGroupHost = {
      getContext: vi.fn<WorkspaceGroupHost["getContext"]>(async () => ({
        channelId: "group", channelType: 2, projectId: "workspace", projectName: "Workspace",
        groupName: "Group", linkedByName: "", source: "linked_existing",
        canOpen: true, canManage: false, isAllMemberGroup: false,
      })),
      open: vi.fn(async () => {}),
      manage: vi.fn(async () => {}),
      subscribe: () => () => {},
    };
    render(
      <WorkspaceGroupProvider value={host}>
        {page["renderConversationHeaderTitle"](channel, info, undefined)}
      </WorkspaceGroupProvider>
    );
    expect(await screen.findByRole("button", { name: "Open workspace: Workspace" })).toBeVisible();
    expect(screen.getByText("Recovered group")).toBeVisible();
    expect(host.getContext).toHaveBeenCalledWith({ channelId: "group", channelType: 2 });
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
