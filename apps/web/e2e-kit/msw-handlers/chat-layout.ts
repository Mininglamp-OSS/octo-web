import type { Page } from "@playwright/test";

async function installChatFollowScenario(page: Page, scenario: string): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eChatFollowTaggingInstalled?: boolean };
    if (w.__e2eChatFollowTaggingInstalled) return;
    const shouldTag = (value: string): boolean => {
      try {
        const path = new URL(value, location.href).pathname;
        return path.endsWith("/sidebar/sync") || path.includes("/follow/") || path.endsWith("/categories");
      } catch {
        return false;
      }
    };
    const tagUrl = (value: string, current: string): string =>
      `${value}${value.includes("?") ? "&" : "?"}e2e_chat_follow=${encodeURIComponent(current)}`;
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const current = sessionStorage.getItem("__e2e_chat_follow_fixture__");
      if (current && shouldTag(String(url))) url = tagUrl(String(url), current);
      return originalOpen.call(this, method, url, ...rest);
    };
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const current = sessionStorage.getItem("__e2e_chat_follow_fixture__");
      if (!current) return originalFetch.call(this, input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!shouldTag(url)) return originalFetch.call(this, input, init);
      if (input instanceof Request) {
        const headers = new Headers(input.headers);
        headers.set("x-e2e-chat-follow-scenario", current);
        return originalFetch.call(this, new Request(input, { headers, ...init }), undefined);
      }
      return originalFetch.call(this, tagUrl(url, current), init);
    };
    w.__e2eChatFollowTaggingInstalled = true;
  });
  await page.evaluate((value) => {
    const w = window as unknown as { __e2eChatFollowTaggingInstalled?: boolean };
    if (!w.__e2eChatFollowTaggingInstalled) {
      const shouldTag = (input: string): boolean => {
        try {
          const path = new URL(input, location.href).pathname;
          return path.endsWith("/sidebar/sync") || path.includes("/follow/") || path.endsWith("/categories");
        } catch {
          return false;
        }
      };
      const tagUrl = (input: string, current: string): string =>
        `${input}${input.includes("?") ? "&" : "?"}e2e_chat_follow=${encodeURIComponent(current)}`;
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const current = sessionStorage.getItem("__e2e_chat_follow_fixture__");
        if (current && shouldTag(String(url))) url = tagUrl(String(url), current);
        return originalOpen.call(this, method, url, ...rest);
      };
      const originalFetch = window.fetch;
      window.fetch = function (input, init) {
        const current = sessionStorage.getItem("__e2e_chat_follow_fixture__");
        if (!current) return originalFetch.call(this, input, init);
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!shouldTag(url)) return originalFetch.call(this, input, init);
        if (input instanceof Request) {
          const headers = new Headers(input.headers);
          headers.set("x-e2e-chat-follow-scenario", current);
          return originalFetch.call(this, new Request(input, { headers, ...init }), undefined);
        }
        return originalFetch.call(this, tagUrl(url, current), init);
      };
      w.__e2eChatFollowTaggingInstalled = true;
    }
    sessionStorage.setItem("__e2e_chat_follow_fixture__", value);
  }, scenario);
}

export async function registerChatLayoutFollowData(page: Page): Promise<void> {
  await installChatFollowScenario(page, `single:${crypto.randomUUID()}`);
}

export async function registerChatFollowUnfollowFixture(page: Page): Promise<void> {
  await installChatFollowScenario(page, `unfollow:${crypto.randomUUID()}`);
}

export async function registerChatFollowSortFixture(page: Page): Promise<void> {
  await installChatFollowScenario(page, `sort:${crypto.randomUUID()}`);
}

export async function registerChatLifecycleHandlers(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { post: (path: string, resolver: () => unknown) => unknown; put: (path: string, resolver: () => unknown) => unknown; delete: (path: string, resolver: () => unknown) => unknown; get: (path: string, resolver: () => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown; arrayBuffer: (body: ArrayBuffer, init?: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[chat-layout] MSW worker 未就绪");
    msw.worker.use(
      msw.http.post("*/follow/channel/unfollow", () => msw.HttpResponse.json({})),
      msw.http.put("*/follow/sort", () => msw.HttpResponse.json({})),
      msw.http.delete("*/message", () => msw.HttpResponse.json({})),
      msw.http.post("*/message/revoke", () => msw.HttpResponse.json({})),
      msw.http.get("*/file/upload/credentials", () => msw.HttpResponse.json({
        uploadUrl: "/e2e-upload/chat-file", downloadUrl: "https://e2e.invalid/chat-file.txt",
        contentType: "text/plain",
      })),
      msw.http.put("*/e2e-upload/chat-file", () => msw.HttpResponse.json({})),
      msw.http.get("*/e2e-upload/chat-file", () => msw.HttpResponse.arrayBuffer(new ArrayBuffer(0))),
    );
  });
}

export async function registerChatLayoutSearchResult(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = globalThis as unknown as { __MSW_READY__?: boolean; __msw?: unknown };
      return w.__MSW_READY__ === true && Boolean(w.__msw);
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.evaluate(() => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { post: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown) => unknown } };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[chat-layout] MSW worker 未就绪");
    msw.worker.use(msw.http.post("*/messages/_search_all", () => msw.HttpResponse.json({ data: [{ result_type: "message", message: {
      message_id: "layout-search-message", message_seq: 1, message_kind: "text", snippet: "E2E 搜索命中消息",
      sender_id: "e2e-user-1", sender_name: "E2E Tester", sent_at: "2026-08-21T10:00:00Z",
      channel_id: "e2e-chat-layout-group", channel_type: 2,
    } }], pagination: {} })));
  });
}

export async function registerChatLayoutThreadCreate(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { post: (path: string, resolver: () => unknown) => unknown; get: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown) => unknown } };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[chat-layout] MSW worker 未就绪");
    const thread = {
      short_id: "e2e-thread-1", channel_id: "e2e-chat-layout-group____e2e-thread-1", name: "E2E 新建子区",
      group_no: "e2e-chat-layout-group", channel_type: 5, status: 1, creator_uid: "e2e-user-1",
    };
    msw.worker.use(
      msw.http.post("*/groups/e2e-chat-layout-group/threads", () => msw.HttpResponse.json(thread)),
      msw.http.get("*/groups/e2e-chat-layout-group/threads", () => msw.HttpResponse.json([thread])),
    );
  });
}

export async function registerChatLayoutGroupCreate(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void }; http: { get: (path: string, resolver: () => unknown) => unknown; post: (path: string, resolver: () => unknown) => unknown }; HttpResponse: { json: (body: unknown) => unknown } };
    type Seed = { currentUid: string; spaceId: string; users: unknown[]; groups: unknown[]; conversations: unknown[]; messages?: unknown[]; subscribers?: unknown[] };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[chat-layout] MSW worker 未就绪");
    msw.worker.use(
      msw.http.get("*/space/e2e-space-001/members", () => msw.HttpResponse.json([{ uid: "e2e-user-2", name: "E2E 建群成员", status: 1, robot: 0 }])),
      msw.http.post("*/group/create", () => {
        const w = window as unknown as { __mockImSeed__?: Seed; __installMockImRuntime__?: (seed: Seed) => void };
        const current = w.__mockImSeed__;
        if (current && w.__installMockImRuntime__) {
          w.__installMockImRuntime__({
            ...current,
            groups: [...current.groups, { group_no: "e2e-created-group", name: "E2E 新建群" }],
            conversations: [...current.conversations, { channelId: "e2e-created-group", channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
          });
        }
        return msw.HttpResponse.json({ group_no: "e2e-created-group" });
      }),
    );
  });
}
