/* eslint-disable no-undef -- e2e handler runs in the browser through MSW */
import type { Page } from "@playwright/test";
import type { MockMessageSeed } from "../_kit/mock-im-runtime";

export async function registerGh1651MessageHistory(
  page: Page,
  message: MockMessageSeed
): Promise<void> {
  // The conversation body loads history over HTTP, separately from the SDK
  // seed used by the sidebar. Serve the same source through that boundary.
  await page.evaluate((source) => {
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
    if (!msw) throw new Error("[GH1651] MSW worker is not ready");

    msw.worker.use(
      msw.http.post("*/message/channel/sync", async ({ request }) => {
        const body = (await request.json()) as {
          channel_id?: string;
          channel_type?: number;
        };
        if (
          body.channel_id !== source.channelId ||
          body.channel_type !== source.channelType
        ) {
          return;
        }
        const messageId = `mock-${source.channelId}-${source.messageSeq}`;
        return msw.HttpResponse.json({
          messages: [
            {
              message_idstr: messageId,
              client_msg_no: messageId,
              message_seq: source.messageSeq,
              channel_id: source.channelId,
              channel_type: source.channelType,
              from_uid: source.fromUid,
              timestamp: source.timestamp ?? 1,
              payload: { type: 1, content: source.content.text },
            },
          ],
        });
      })
    );
  }, message);
}
