import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createTestViewHost } from "./testViewHost";

vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: { commonDataSource: { getImageURL: vi.fn(() => "") } },
  },
}));

vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }));

function png(name = "screenshot.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

async function mountComposer() {
  let context: MessageInputContext | undefined;
  const view = render(
    <ChatComposer host={createTestViewHost()} onContext={(next) => { context = next; }} onSend={vi.fn()} />
  );
  await waitFor(() => expect(context).toBeDefined());
  return { view, context: context! };
}

/** Select the whole draft so any editor insertion would replace it. */
function selectAll(container: HTMLElement) {
  const editor = container.querySelector(".ProseMirror") as HTMLElement | null;
  expect(editor).not.toBeNull();
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(editor!);
  selection.removeAllRanges();
  selection.addRange(range);
  return editor!;
}

describe("screenshot attachment is non-destructive to the draft", () => {
  it("keeps selected draft text intact when the capture is added as an upload", async () => {
    const { view, context } = await mountComposer();
    context.restoreDraft("keep this draft text");
    await waitFor(() => expect(context.text()).toContain("keep this draft text"));
    const editor = selectAll(view.container);

    // The production path used by ScreenshotToolbar.
    await act(async () => { await context.addAttachment([png()], "upload"); });

    // The draft must survive verbatim: no inline attachment node replaced the selection.
    expect(context.text()).toContain("keep this draft text");
    expect(view.container.querySelectorAll(".ProseMirror img").length).toBe(0);
    expect(editor.querySelectorAll("[data-type='attachment']").length).toBe(0);
    expect(context.getAttachmentFiles().map((file) => file.name)).toEqual(["screenshot.png"]);
  });

  it("documents the destructive behaviour of the paste source this toolbar must not use", async () => {
    const { view, context } = await mountComposer();
    context.restoreDraft("draft that paste would eat");
    await waitFor(() => expect(context.text()).toContain("draft that paste would eat"));
    selectAll(view.container);

    await act(async () => { await context.addAttachment([png()], "paste"); });

    // Pasting inserts an inline node at the live selection, which is why the toolbar uses "upload".
    expect(view.container.querySelector("[data-type='attachment']")).not.toBeNull();
  });
});
