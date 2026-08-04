import { afterEach, describe, expect, it } from "vitest";
import {
  Channel,
  ChannelInfo,
  ChannelTypeGroup,
  ChannelTypePerson,
} from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../../Service/Const";
import { TitleContextStore } from "../../../features/documentTitle/titleContextStore";
import { ChatPageTitleController } from "../chatPageTitleController";

function channelInfo(channel: Channel, title: string, orgData?: object) {
  return { channel, title, orgData } as ChannelInfo;
}

describe("ChatPageTitleController", () => {
  const contexts = new TitleContextStore();
  const infos = new Map<string, ChannelInfo>();
  const controller = new ChatPageTitleController({
    getChannelInfo: (channel) => infos.get(channel.getChannelKey()),
    titleContextStore: contexts,
  });

  afterEach(() => {
    controller.clear();
    contexts.clear("chat");
    infos.clear();
  });

  it("uses the actual conversation page opened outside the sidebar", () => {
    const botFather = new Channel("botfather", ChannelTypePerson);
    infos.set(botFather.getChannelKey(), channelInfo(botFather, "BotFather"));

    controller.activate(botFather, Symbol("contacts-entry"));

    expect(contexts.get("chat")).toEqual({
      primaryTitle: "BotFather",
      parentTitle: undefined,
    });
  });

  it("commits a title when the opened channel info arrives later", () => {
    const person = new Channel("testuser-124", ChannelTypePerson);
    controller.activate(person, Symbol("contacts-entry"));
    expect(contexts.get("chat")).toBeUndefined();

    const info = channelInfo(person, "Test User 124");
    infos.set(person.getChannelKey(), info);
    expect(controller.handleChannelInfoChanged(info)).toBe(true);

    expect(contexts.get("chat")).toEqual({
      primaryTitle: "Test User 124",
      parentTitle: undefined,
    });
  });

  it("formats a full-screen Thread from its parent group and Thread title", () => {
    const thread = new Channel(
      "product-team____design-review",
      ChannelTypeCommunityTopic
    );
    const parent = new Channel("product-team", ChannelTypeGroup);
    infos.set(
      thread.getChannelKey(),
      channelInfo(thread, "产品设计讨论", {
        parentGroupNo: "product-team",
      })
    );
    infos.set(parent.getChannelKey(), channelInfo(parent, "北京产研团队"));

    controller.activate(thread, Symbol("thread-page"));

    expect(contexts.get("chat")).toEqual({
      primaryTitle: "产品设计讨论",
      parentTitle: "北京产研团队",
    });
  });

  it("ignores unrelated channel updates", () => {
    const current = new Channel("current", ChannelTypePerson);
    infos.set(current.getChannelKey(), channelInfo(current, "Current"));
    controller.activate(current, Symbol("current-page"));

    const unrelated = channelInfo(
      new Channel("unrelated", ChannelTypePerson),
      "Unrelated"
    );
    infos.set(unrelated.channel.getChannelKey(), unrelated);

    expect(controller.handleChannelInfoChanged(unrelated)).toBe(false);
    expect(contexts.get("chat")?.primaryTitle).toBe("Current");
  });

  it("does not let an old page unmount clear the newer page title", () => {
    const firstOwner = Symbol("first-page");
    const secondOwner = Symbol("second-page");
    const first = new Channel("first", ChannelTypePerson);
    const second = new Channel("second", ChannelTypePerson);
    infos.set(first.getChannelKey(), channelInfo(first, "First"));
    infos.set(second.getChannelKey(), channelInfo(second, "Second"));

    controller.activate(first, firstOwner);
    controller.activate(second, secondOwner);
    controller.deactivate(firstOwner);

    expect(contexts.get("chat")?.primaryTitle).toBe("Second");
  });

  it("stays cleared after Chat is left even if the hidden page receives updates", () => {
    const person = new Channel("testuser-124", ChannelTypePerson);
    const info = channelInfo(person, "Test User 124");
    infos.set(person.getChannelKey(), info);
    controller.activate(person, Symbol("chat-page"));

    controller.clear();
    expect(contexts.get("chat")).toBeUndefined();

    expect(controller.handleChannelInfoChanged(info)).toBe(false);
    expect(contexts.get("chat")).toBeUndefined();
  });
});
