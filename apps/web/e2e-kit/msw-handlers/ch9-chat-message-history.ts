/* eslint-disable no-undef -- e2e handler runs in the browser through MSW */
import type { Page } from "@playwright/test";

export async function registerCh9ChatMessageHistory(
  page: Page,
  fromUid = "e2e-user-2"
): Promise<void> {
  await page.evaluate((messageFromUid) => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        post: (
          path: string,
          resolver: (info: { request: Request }) => unknown
        ) => unknown;
      };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: MSW }).__msw;
    if (!msw) throw new Error("[CH9] MSW worker 未就绪");

    msw.worker.use(
      msw.http.post("*/message/channel/sync", async ({ request }) => {
        const body = (await request.json()) as {
          channel_id?: string;
          channel_type?: number;
        };
        if (
          body.channel_id !== "e2e-chat-context-menu-group" ||
          body.channel_type !== 2
        ) {
          return msw.HttpResponse.json({ messages: [] });
        }
        return msw.HttpResponse.json({
          messages: [
            {
              message_idstr: "mock-e2e-chat-context-menu-message-1",
              client_msg_no: "mock-e2e-chat-context-menu-message-1",
              message_seq: 1,
              channel_id: "e2e-chat-context-menu-group",
              channel_type: 2,
              from_uid: messageFromUid,
              timestamp: 1,
              payload: { type: 1, content: "E2E 历史文本消息" },
            },
          ],
        });
      })
    );
  }, fromUid);
}
