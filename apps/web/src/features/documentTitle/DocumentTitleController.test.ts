import { describe, expect, it, vi } from "vitest";
import { TitleContextStore } from "../../../../../packages/dmworkbase/src/features/documentTitle/titleContextStore";
import {
  DocumentTitleController,
  resolveTitleMenuId,
} from "./DocumentTitleController";

vi.mock("@octo/base", async () => {
  return import(
    "../../../../../packages/dmworkbase/src/features/documentTitle"
  );
});

describe("DocumentTitleController", () => {
  it("uses the owning module for full-page summary and document routes", () => {
    expect(resolveTitleMenuId("/s/task_1", "chat")).toBe("summary");
    expect(resolveTitleMenuId("/s/share/share_1", "chat")).toBe("summary");
    expect(resolveTitleMenuId("/d/doc_1", "chat")).toBe("docs");
    expect(resolveTitleMenuId("/contacts", "contacts")).toBe("contacts");
  });

  it("renders from the active menu context and reacts without polling", async () => {
    const target = { title: "Octo" };
    const store = new TitleContextStore();
    let activeMenu = { id: "chat", title: "会话" };
    let unreadCount = 2;
    const menuListeners = new Set<() => void>();
    const unreadListeners = new Set<() => void>();
    const controller = new DocumentTitleController({
      target,
      contexts: store,
      getActiveMenu: () => activeMenu,
      getUnreadConversationCount: () => unreadCount,
      subscribeActiveMenu: (listener) => {
        menuListeners.add(listener);
        return () => menuListeners.delete(listener);
      },
      subscribeUnreadChanges: (listener) => {
        unreadListeners.add(listener);
        return () => unreadListeners.delete(listener);
      },
    });

    controller.start();
    expect(target.title).toBe("(2) 会话 - Octo");

    store.set("chat", { primaryTitle: "产品群" });
    await Promise.resolve();
    expect(target.title).toBe("(2) 产品群 - Octo");

    activeMenu = { id: "docs", title: "文档" };
    store.set("docs", { primaryTitle: "年度经营计划", moduleTitle: "文档" });
    for (const listener of menuListeners) listener();
    await Promise.resolve();
    expect(target.title).toBe("(2) 年度经营计划 - 文档 - Octo");

    unreadCount = 0;
    for (const listener of unreadListeners) listener();
    await Promise.resolve();
    expect(target.title).toBe("年度经营计划 - 文档 - Octo");
  });

  it("commits only the final title for a synchronous context and unread burst", async () => {
    const writes: string[] = [];
    let currentTitle = "Octo";
    const target = {
      get title() {
        return currentTitle;
      },
      set title(value: string) {
        currentTitle = value;
        writes.push(value);
      },
    };
    const store = new TitleContextStore();
    let unreadCount = 1;
    const unreadListeners = new Set<() => void>();
    const controller = new DocumentTitleController({
      target,
      contexts: store,
      getActiveMenu: () => ({ id: "chat", title: "Conversation" }),
      getUnreadConversationCount: () => unreadCount,
      subscribeActiveMenu: () => () => undefined,
      subscribeUnreadChanges: (listener) => {
        unreadListeners.add(listener);
        return () => unreadListeners.delete(listener);
      },
    });

    controller.start();
    expect(target.title).toBe("(1) Conversation - Octo");
    writes.length = 0;

    store.set("chat", { primaryTitle: "Test User 124" });
    unreadCount = 0;
    for (const listener of unreadListeners) listener();
    await Promise.resolve();

    expect(writes).toEqual(["Test User 124 - Octo"]);
  });

  it("recalculates unread after account state is restored outside the chat page", async () => {
    const target = { title: "Octo" };
    const store = new TitleContextStore();
    let unreadCount = 0;
    let finishRestore: (() => void) | undefined;
    const restoreUnreadState = new Promise<void>((resolve) => {
      finishRestore = () => {
        unreadCount = 1;
        resolve();
      };
    });
    const controller = new DocumentTitleController({
      target,
      contexts: store,
      getActiveMenu: () => ({ id: "contacts", title: "Contacts" }),
      getUnreadConversationCount: () => unreadCount,
      subscribeActiveMenu: () => () => undefined,
      subscribeUnreadChanges: () => () => undefined,
      restoreUnreadState: () => restoreUnreadState,
    });

    controller.start();
    expect(target.title).toBe("Contacts - Octo");

    finishRestore?.();
    await restoreUnreadState;
    await Promise.resolve();

    expect(target.title).toBe("(1) Contacts - Octo");
  });

  it("does not commit a queued title after stop", async () => {
    const target = { title: "Octo" };
    const store = new TitleContextStore();
    const controller = new DocumentTitleController({
      target,
      contexts: store,
      getActiveMenu: () => ({ id: "chat", title: "Conversation" }),
      getUnreadConversationCount: () => 0,
      subscribeActiveMenu: () => () => undefined,
      subscribeUnreadChanges: () => () => undefined,
    });

    controller.start();
    expect(target.title).toBe("Conversation - Octo");

    store.set("chat", { primaryTitle: "Test User 124" });
    controller.stop();
    await Promise.resolve();

    expect(target.title).toBe("Conversation - Octo");
  });

  it("clears account-owned title state immediately after logout", async () => {
    const target = { title: "Octo" };
    const store = new TitleContextStore();
    const authListeners = new Set<() => void>();
    let isLoggedIn = true;
    store.set("chat", { primaryTitle: "产品群" });
    const controller = new DocumentTitleController({
      target,
      contexts: store,
      getActiveMenu: () => ({ id: "chat", title: "会话" }),
      getUnreadConversationCount: () => 3,
      getIsLoggedIn: () => isLoggedIn,
      subscribeActiveMenu: () => () => undefined,
      subscribeUnreadChanges: () => () => undefined,
      subscribeAuthChanges: (listener) => {
        authListeners.add(listener);
        return () => authListeners.delete(listener);
      },
    });

    controller.start();
    expect(target.title).toBe("(3) 产品群 - Octo");

    isLoggedIn = false;
    for (const listener of authListeners) listener();
    await Promise.resolve();

    expect(target.title).toBe("Octo");
  });

  it("stops every subscription", () => {
    const unsubscribeMenu = vi.fn();
    const unsubscribeUnread = vi.fn();
    const unsubscribeLocale = vi.fn();
    const unsubscribeAuth = vi.fn();
    const contexts = new TitleContextStore();
    const unsubscribeContext = vi.spyOn(contexts, "subscribe");
    const controller = new DocumentTitleController({
      target: { title: "Octo" },
      contexts,
      getActiveMenu: () => undefined,
      getUnreadConversationCount: () => 0,
      subscribeActiveMenu: () => unsubscribeMenu,
      subscribeUnreadChanges: () => unsubscribeUnread,
      subscribeLocaleChanges: () => unsubscribeLocale,
      subscribeAuthChanges: () => unsubscribeAuth,
    });

    controller.start();
    controller.stop();

    expect(unsubscribeMenu).toHaveBeenCalledOnce();
    expect(unsubscribeUnread).toHaveBeenCalledOnce();
    expect(unsubscribeLocale).toHaveBeenCalledOnce();
    expect(unsubscribeAuth).toHaveBeenCalledOnce();
    expect(unsubscribeContext).toHaveBeenCalledOnce();
  });

  it("re-renders localized fallback titles when the locale changes", async () => {
    const target = { title: "Octo" };
    const store = new TitleContextStore();
    let fallbackTitle = "通讯录";
    const localeListeners = new Set<() => void>();
    const controller = new DocumentTitleController({
      target,
      contexts: store,
      getActiveMenu: () => ({ id: "contacts", title: fallbackTitle }),
      getUnreadConversationCount: () => 0,
      subscribeActiveMenu: () => () => undefined,
      subscribeUnreadChanges: () => () => undefined,
      subscribeLocaleChanges: (listener) => {
        localeListeners.add(listener);
        return () => localeListeners.delete(listener);
      },
    });

    controller.start();
    expect(target.title).toBe("通讯录 - Octo");

    fallbackTitle = "Contacts";
    for (const listener of localeListeners) listener();
    await Promise.resolve();

    expect(target.title).toBe("Contacts - Octo");
  });
});
