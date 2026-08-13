import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import WKApp from "../../../../App";
import { createChatSendOutcome } from "../../domain";
import { encodeOctoRichTextClipboardPayload } from "../../../../Utils/richTextClipboard";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";

vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: {
      commonDataSource: { getImageURL: vi.fn(() => "") },
    },
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
}));

function conversationContext() {
  return {
    channel: () => new Channel("channel", ChannelTypeGroup),
  } as any;
}

function paste(
  target: Element,
  values: { plain?: string; html?: string; files?: File[] },
): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => {
        if (type === "text/plain") return values.plain ?? "";
        if (type === "text/html") return values.html ?? "";
        return "";
      },
      files: values.files ?? [],
      items: [],
    },
  });
  fireEvent(target, event);
  return event;
}

describe("MessageInput clipboard integration", () => {
  it("routes a file-only paste through the pending attachment port", async () => {
    let inputContext: MessageInputContext | undefined;
    const onAddPendingAttachments = vi.fn().mockResolvedValue(true);
    const view = render(
      <ChatComposer
        context={conversationContext()}
        onContext={(context) => {
          inputContext = context;
        }}
        onAddPendingAttachments={onAddPendingAttachments}
      />
    );
    await waitFor(() => expect(inputContext).toBeDefined());
    const editor = view.container.querySelector(".ProseMirror");
    expect(editor).not.toBeNull();
    const file = new File(["image"], "screenshot.png", {
      type: "image/png",
    });

    const event = paste(editor!, { files: [file] });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(onAddPendingAttachments).toHaveBeenCalledWith([file], "paste"),
    );
    act(() => inputContext?.clear());
  });

  it("preserves pasted HTML links at the send boundary without auto-linking .md text", async () => {
    let inputContext: MessageInputContext | undefined;
    const onSend = vi.fn(() =>
      createChatSendOutcome({ editorConsumed: true }),
    );
    const view = render(
      <ChatComposer
        context={conversationContext()}
        onContext={(context) => {
          inputContext = context;
        }}
        onSend={onSend}
      />
    );
    await waitFor(() => expect(inputContext).toBeDefined());
    const editor = view.container.querySelector(".ProseMirror");
    expect(editor).not.toBeNull();

    paste(editor!, {
      plain: "Example README.md",
      html: '<p><a href="https://example.com/docs">Example</a> README.md</p>',
    });
    await waitFor(() =>
      expect(inputContext?.text()).toBe("Example README.md"),
    );

    await act(async () => {
      await inputContext?.send();
    });

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "[Example](https://example.com/docs) README.md",
      }),
    );
    act(() => inputContext?.clear());
  });

  it("keeps an exclamation before a pasted link from becoming a Markdown image", async () => {
    let inputContext: MessageInputContext | undefined;
    const onSend = vi.fn(() =>
      createChatSendOutcome({ editorConsumed: true }),
    );
    const view = render(
      <ChatComposer
        context={conversationContext()}
        onContext={(context) => {
          inputContext = context;
        }}
        onSend={onSend}
      />
    );
    await waitFor(() => expect(inputContext).toBeDefined());
    const editor = view.container.querySelector(".ProseMirror");
    expect(editor).not.toBeNull();

    paste(editor!, {
      plain: "!Example",
      html: '<p>!<a href="https://example.com/pixel.png">Example</a></p>',
    });
    await waitFor(() => expect(inputContext?.text()).toBe("!Example"));

    await act(async () => {
      await inputContext?.send();
    });

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "\\![Example](https://example.com/pixel.png)",
      }),
    );
    act(() => inputContext?.clear());
  });

  it("does not add a delayed rich-text image after the composer unmounts", async () => {
    let inputContext: MessageInputContext | undefined;
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetch = vi.fn(() => fetchPromise);
    const blob = new Blob(["image"], { type: "image/png" });
    const response = {
      ok: true,
      body: undefined,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "image/png" : null,
      },
      blob: vi.fn().mockResolvedValue(blob),
    } as unknown as Response;
    const onAddPendingAttachments = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("fetch", fetch);
    vi.mocked(
      WKApp.dataSource.commonDataSource.getImageURL,
    ).mockReturnValue("https://cdn.example.com/a.png");

    const view = render(
      <ChatComposer
        context={conversationContext()}
        onContext={(context) => {
          inputContext = context;
        }}
        onAddPendingAttachments={onAddPendingAttachments}
      />
    );
    try {
      await waitFor(() => expect(inputContext).toBeDefined());
      const editor = view.container.querySelector(".ProseMirror");
      expect(editor).not.toBeNull();
      const payload = encodeOctoRichTextClipboardPayload({
        version: 1,
        blocks: [
          { type: "image", url: "https://cdn.example.com/a.png" },
        ],
      });

      paste(editor!, {
        html: `<div data-octo-richtext="${payload}"></div>`,
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      view.unmount();
      resolveFetch?.(response);
      await waitFor(() => expect(response.blob).toHaveBeenCalledOnce());

      expect(onAddPendingAttachments).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(
        WKApp.dataSource.commonDataSource.getImageURL,
      ).mockReturnValue("");
    }
  });
});
