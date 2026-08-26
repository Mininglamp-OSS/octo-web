// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  routeRegister: vi.fn(),
  menuRegister: vi.fn(),
  replaceToRoot: vi.fn(),
  popToRoot: vi.fn(),
  emit: vi.fn(),
  requestSwitch: vi.fn((action: () => void) => {
    action();
    return true;
  }),
  chatPage: vi.fn(() => null),
  remoteConfig: { mailOn: true },
}));

vi.mock("@octo/base", () => {
  class Menus {
    onPress?: () => void;
    constructor(
      public id: string,
      public routePath: string,
      public title: string
    ) {}
  }
  return {
    ChatPage: state.chatPage,
    i18n: { registerNamespace: vi.fn() },
    Menus,
    t: (key: string) => key,
    WKApp: {
      route: { register: state.routeRegister },
      menus: { register: state.menuRegister },
      routeLeft: { popToRoot: state.popToRoot },
      routeRight: { replaceToRoot: state.replaceToRoot },
      mittBus: { emit: state.emit },
      remoteConfig: state.remoteConfig,
    },
  };
});

vi.mock("./bridge/mailboxContext", () => ({
  requestMailWorkspaceSwitch: state.requestSwitch,
}));
vi.mock("./features/MailSidebar", () => ({ default: () => null }));
vi.mock("./features/MailRecordsFeature", () => ({ default: () => null }));
vi.mock("./features/MailAuthorizationPage", () => ({ default: () => null }));

import MailModule from "./module";

describe("MailModule integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.remoteConfig.mailOn = true;
  });

  it("registers /mail with the host shell and guards menu navigation", () => {
    new MailModule().init();

    const mailRoute = state.routeRegister.mock.calls.find(
      ([path]) => path === "/mail"
    );
    expect(mailRoute?.[2]?.hostShell).toBeTypeOf("function");
    const shell = mailRoute?.[2]?.hostShell();
    expect(React.isValidElement(shell)).toBe(true);
    expect(shell.type).toBe(state.chatPage);

    const menuFactory = state.menuRegister.mock.calls.find(
      ([id]) => id === "mail"
    )?.[1];
    state.remoteConfig.mailOn = false;
    expect(menuFactory()).toBeUndefined();

    state.remoteConfig.mailOn = true;
    const menu = menuFactory();
    menu.onPress();

    expect(state.requestSwitch).toHaveBeenCalledTimes(1);
    expect(state.popToRoot).toHaveBeenCalledTimes(1);
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);
    expect(state.emit).toHaveBeenCalledWith("mail-open-inbox");

    const authorizationRoute = state.routeRegister.mock.calls.find(
      ([path]) => path === "/mail/authorize"
    );
    const onSessionExpired = vi.fn();
    const page = authorizationRoute?.[1]({ onSessionExpired });

    expect(React.isValidElement(page)).toBe(true);
    expect(page.props.onSessionExpired).toBe(onSessionExpired);
  });
});
