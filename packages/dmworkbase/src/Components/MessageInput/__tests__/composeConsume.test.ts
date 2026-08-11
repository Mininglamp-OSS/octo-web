/**
 * Integration coverage for the consume-first compose flow (octo-web#1280).
 *
 * The first round of this fix was reviewed as "the tests don't reach the code
 * that carries the risk": every scenario was asserted against `vi.fn()` spies, so
 * no test ever mutated a document. These tests drive a **real Tiptap editor**
 * through `consumeCompose` + `runSendWithConsumedCompose`, which is where the
 * dangerous cases live:
 *   - the user keeps typing while the send is in flight;
 *   - a send that never got enqueued must give the content back — before the new
 *     draft, never overwriting it;
 *   - one of several pasted images is rejected and must come back alone;
 *   - the editor was destroyed meanwhile (channel switch) → the content cannot be
 *     restored, which must be reported instead of vanishing silently;
 *   - queued sends stay ordered and each carries its own reply/edit target.
 *
 * The attachment node here mirrors the production schema (inline atom named
 * "attachment" carrying id/previewUrl) without the React node view: these tests
 * are about document manipulation, not rendering.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  composeSnapshotText,
  consumeCompose,
  ComposeRestoreUnavailableError,
  type ComposeDoc,
  type ComposeEditorPort,
  type TopAttachmentLike,
} from "../composeConsume";
import {
  createSendQueue,
  runSendWithConsumedCompose,
  type SendResult,
} from "../sendFlow";
import { captureSendTarget } from "../../Conversation/sendTarget";

const TestAttachment = Node.create({
  name: "attachment",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      id: { default: null },
      name: { default: "" },
      previewUrl: { default: undefined },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-attachment]" }];
  },
  renderHTML() {
    return ["span", { "data-attachment": "" }];
  },
});

const editors: Editor[] = [];

function makeEditor(content?: unknown): Editor {
  const editor = new Editor({
    // Mirrors the composer's own extension set (StarterKit, rich formatting
    // disabled) and uses only dependencies `@octo/base` declares, so the suite
    // also resolves under a strict pnpm install.
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
        code: false,
        heading: false,
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
        strike: false,
        link: false,
      }),
      TestAttachment,
    ],
    content: content as never,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => {
    if (!editor.isDestroyed) editor.destroy();
  });
});

function port(editor: Editor): ComposeEditorPort {
  return {
    getJSON: () => editor.getJSON() as ComposeDoc,
    isEmpty: () => editor.isEmpty,
    isDestroyed: () => editor.isDestroyed,
    clearContent: () => editor.commands.clearContent(),
    setContent: (doc) => editor.commands.setContent(doc as never),
    insertContentAtBlock: (blockOffset, nodes) => {
      const docNode = editor.state.doc;
      const limit = Math.min(blockOffset, docNode.childCount);
      let pos = 0;
      for (let i = 0; i < limit; i++) pos += docNode.child(i).nodeSize;
      editor.commands.insertContentAt(pos, nodes as never);
    },
    appendContent: (nodes) => editor.commands.insertContent(nodes as never),
    focusEnd: () => editor.commands.focus("end"),
  };
}

interface Harness {
  editor: Editor;
  files: Map<string, File>;
  top: TopAttachmentLike[];
  revoked: string[];
  errors: Array<{ step: string; err: unknown }>;
  restoredCompose: number;
  /** Mirrors MessageInput's restore-offset ref (reset on every consume). */
  offsets: { blocks: number; topAttachments: number };
}

function harness(content?: unknown, top: TopAttachmentLike[] = []): Harness {
  return {
    editor: makeEditor(content),
    files: new Map<string, File>(),
    top: [...top],
    revoked: [],
    errors: [],
    restoredCompose: 0,
    offsets: { blocks: 0, topAttachments: 0 },
  };
}

function consume(h: Harness) {
  // The component resets the offsets on every consume, because consuming clears
  // the editor and removes this send's attachments.
  h.offsets = { blocks: 0, topAttachments: 0 };
  return consumeCompose({
    editor: port(h.editor),
    attachmentFiles: h.files,
    getTopAttachments: () => h.top,
    setTopAttachments: (items) => {
      h.top = items;
    },
    revokeObjectURL: (url) => h.revoked.push(url),
    getRestoreOffsets: () => h.offsets,
    onRestored: ({ blocks, topAttachments }) => {
      h.offsets = {
        blocks: h.offsets.blocks + blocks,
        topAttachments: h.offsets.topAttachments + topAttachments,
      };
    },
    onRestoreCompose: () => {
      h.restoredCompose += 1;
    },
    onRestoreError: (err, step) => h.errors.push({ step, err }),
  });
}

const attachment = (id: string, previewUrl?: string) => ({
  type: "attachment",
  attrs: { id, name: `${id}.png`, previewUrl },
});

const doc = (...content: unknown[]) => ({ type: "doc", content });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string) => ({ type: "text", text: value });

describe("consumeCompose — the composer is emptied synchronously", () => {
  it("clears the editor and removes this send's top attachments before any await", () => {
    const h = harness(doc(para(text("hello"))), [
      { id: "t1", previewUrl: "blob:t1" },
    ]);

    const handle = consume(h);

    expect(h.editor.getText()).toBe("");
    expect(h.top).toEqual([]);
    expect(handle.ids.topIds).toEqual(["t1"]);
    expect(composeSnapshotText(handle.snapshot)).toBe("hello");
  });

  it("captures pasted attachment ids in document order", () => {
    const h = harness(
      doc(
        para(text("a"), attachment("img-1", "blob:1")),
        para(attachment("img-2", "blob:2"), text("b")),
      ),
    );

    const handle = consume(h);

    expect(handle.ids.editorAttachmentIds).toEqual(["img-1", "img-2"]);
  });
});

describe("consumeCompose — a send that was never enqueued gives the content back", () => {
  it("restores the original document when the composer is still empty", async () => {
    const h = harness(doc(para(text("retry me"))));
    const handle = consume(h);

    await runSendWithConsumedCompose(
      () => false as SendResult,
      handle.ids,
      handle.compose,
    );

    expect(h.editor.getText()).toBe("retry me");
    expect(h.restoredCompose).toBe(1);
    expect(h.errors).toEqual([]);
  });

  it("inserts the failed content BEFORE a draft typed during the await (no overwrite)", async () => {
    const h = harness(doc(para(text("first message"))));
    const handle = consume(h);

    // The user starts the next message while the send is still pending.
    h.editor.commands.insertContent("next draft");

    await runSendWithConsumedCompose(
      () => false as SendResult,
      handle.ids,
      handle.compose,
    );

    const value = h.editor.getText();
    expect(value).toContain("first message");
    expect(value).toContain("next draft");
    expect(value.indexOf("first message")).toBeLessThan(
      value.indexOf("next draft"),
    );
  });

  it("keeps pasted-image File refs and preview URLs alive for the retry", async () => {
    const h = harness(doc(para(text("cap"), attachment("img-1", "blob:1"))));
    h.files.set("img-1", new File(["x"], "img-1.png", { type: "image/png" }));
    const handle = consume(h);

    await runSendWithConsumedCompose(
      () => false as SendResult,
      handle.ids,
      handle.compose,
    );

    expect(h.editor.getJSON()).toEqual(
      expect.objectContaining({ type: "doc" }),
    );
    expect(JSON.stringify(h.editor.getJSON())).toContain("img-1");
    expect(h.files.has("img-1")).toBe(true);
    expect(h.revoked).toEqual([]);
  });

  it("restores unsent top attachments while keeping ones queued during the await", async () => {
    const h = harness(doc(para(text("x"))), [
      { id: "t1", previewUrl: "blob:t1" },
      { id: "t2", previewUrl: "blob:t2" },
    ]);
    const handle = consume(h);

    // The user adds another file while the send is pending.
    h.top = [...h.top, { id: "t3", previewUrl: "blob:t3" }];

    // t1 was actually sent, t2 was rejected by the pre-check.
    await runSendWithConsumedCompose(
      () => ({ editorConsumed: true, consumedTopIds: ["t1"] }),
      handle.ids,
      handle.compose,
    );

    expect(h.top.map((item) => item.id)).toEqual(["t2", "t3"]);
    expect(h.revoked).toEqual(["blob:t1"]);
  });
});

describe("consumeCompose — partial pasted-attachment failure", () => {
  it("brings back only the rejected image and disposes the sent one", async () => {
    const h = harness(
      doc(para(text("two pics"), attachment("img-1", "blob:1"), attachment("img-2", "blob:2"))),
    );
    h.files.set("img-1", new File(["1"], "img-1.png", { type: "image/png" }));
    h.files.set("img-2", new File(["2"], "img-2.png", { type: "image/png" }));
    const handle = consume(h);

    await runSendWithConsumedCompose(
      () => ({
        editorConsumed: true,
        consumedTopIds: [],
        unsentEditorAttachmentIds: ["img-2"],
      }),
      handle.ids,
      handle.compose,
    );

    const json = JSON.stringify(h.editor.getJSON());
    expect(json).toContain("img-2");
    expect(json).not.toContain("img-1");
    // The sent image is released; the rejected one stays retryable.
    expect(h.files.has("img-1")).toBe(false);
    expect(h.files.has("img-2")).toBe(true);
    expect(h.revoked).toEqual(["blob:1"]);
    // Sent text is NOT re-inserted — only the rejected attachment comes back.
    expect(h.editor.getText()).not.toContain("two pics");
  });
});

describe("consumeCompose — the editor is gone (channel switch mid-flight)", () => {
  it("reports an unrestorable compose instead of silently dropping it", async () => {
    const h = harness(doc(para(text("lost?"))), [
      { id: "t1", previewUrl: "blob:t1" },
    ]);
    const handle = consume(h);

    h.editor.destroy(); // switching conversation unmounts MessageInput

    const ok = await runSendWithConsumedCompose(
      () => false as SendResult,
      handle.ids,
      handle.compose,
    );

    expect(ok).toBe(false);
    // The user is told (MessageInput turns this into a notification)…
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].step).toBe("restoreEditor");
    expect(h.errors[0].err).toBeInstanceOf(ComposeRestoreUnavailableError);
    // …the unsent top attachments were still put back first…
    expect(h.top.map((item) => item.id)).toEqual(["t1"]);
    // …and the compose-level side effects (reply/edit target, expanded state)
    // ran even though the document could not be restored.
    expect(h.restoredCompose).toBe(1);
  });
});

describe("send queue — consecutive sends keep their own target and order", () => {
  it("runs queued composes in order, each with the reply target captured at press time", async () => {
    const vm: { reply?: string; handlerType: number } = {
      reply: "message-X",
      handlerType: 1,
    };
    const host = {
      getReplyMessage: () => vm.reply,
      setReplyMessage: (m: string | undefined) => {
        vm.reply = m;
      },
      getHandlerType: () => vm.handlerType,
      setHandlerType: (h: number) => {
        vm.handlerType = h;
      },
    };
    const queue = createSendQueue();
    const seen: Array<string | undefined> = [];
    const gates: Array<() => void> = [];

    const send = (target: { replyMessage?: string }) =>
      queue.enqueue(
        () =>
          new Promise<void>((resolve) => {
            seen.push(target.replyMessage);
            gates.push(resolve);
          }),
      );

    // A: replying to message-X. The target is taken synchronously…
    const first = send(captureSendTarget(host));
    expect(vm.reply).toBeUndefined(); // …so the banner is already gone.

    // While A is pending the user switches to "edit" on an unrelated message.
    vm.reply = "message-Y";
    vm.handlerType = 2;
    const second = send(captureSendTarget(host));

    await Promise.resolve();
    // B must not start before A finished (ordering), and A must not see Y.
    expect(seen).toEqual(["message-X"]);
    gates[0]();
    await first;
    await Promise.resolve();
    gates[1]();
    await second;

    expect(seen).toEqual(["message-X", "message-Y"]);
    expect(queue.pending).toBe(0);
  });

  it("restores the captured target when the send was not enqueued, unless a newer one exists", () => {
    const vm: { reply?: string; handlerType: number } = {
      reply: "message-X",
      handlerType: 2,
    };
    const host = {
      getReplyMessage: () => vm.reply,
      setReplyMessage: (m: string | undefined) => {
        vm.reply = m;
      },
      getHandlerType: () => vm.handlerType,
      setHandlerType: (h: number) => {
        vm.handlerType = h;
      },
    };

    const captured = captureSendTarget(host);
    expect(vm.reply).toBeUndefined();

    captured.restore();
    // Edit mode is back, so a retry still edits message-X instead of sending new.
    expect(vm.reply).toBe("message-X");
    expect(vm.handlerType).toBe(2);

    // A newer selection always wins over a late restore.
    const second = captureSendTarget(host);
    vm.reply = "message-Z";
    second.restore();
    expect(vm.reply).toBe("message-Z");
  });
});

describe("composeSnapshotText", () => {
  it("flattens text, mentions and line breaks for draft persistence", () => {
    const snapshot = doc(
      para(text("hi "), { type: "attachment", attrs: { id: "a" } }),
      para(text("bye")),
    ) as ComposeDoc;
    expect(composeSnapshotText(snapshot)).toBe("hi \nbye");
  });

  it("returns an empty string for an empty compose", () => {
    expect(composeSnapshotText(undefined)).toBe("");
    expect(composeSnapshotText({ type: "doc", content: [] })).toBe("");
  });
});

describe("consumeCompose — success leaves the composer alone", () => {
  it("does not touch a draft typed during the await", async () => {
    const h = harness(doc(para(text("sent text"))));
    const handle = consume(h);
    h.editor.commands.insertContent("brand new draft");

    const ok = await runSendWithConsumedCompose(
      () => true as SendResult,
      handle.ids,
      handle.compose,
    );

    expect(ok).toBe(true);
    // The classic #1280 symptom would leave "sent text" behind here.
    expect(h.editor.getText()).toBe("brand new draft");
    expect(vi.isMockFunction(h.editor.commands.setContent)).toBe(false);
  });
});

describe("consumeCompose — two queued sends that both fail keep their order", () => {
  it("restores as A, B, <live draft> instead of stacking up reversed", async () => {
    const h = harness(doc(para(text("AAA"))));
    const handleA = consume(h);

    // The user immediately types and sends the next message; both are queued.
    h.editor.commands.insertContent("BBB");
    const handleB = consume(h);

    // ...and then starts a third draft while both sends are in flight.
    h.editor.commands.insertContent("live draft");

    // Both fail before enqueue (e.g. upload credentials rejected).
    await runSendWithConsumedCompose(
      () => false as SendResult,
      handleA.ids,
      handleA.compose,
    );
    await runSendWithConsumedCompose(
      () => false as SendResult,
      handleB.ids,
      handleB.compose,
    );

    const value = h.editor.getText();
    expect(value.indexOf("AAA")).toBeGreaterThanOrEqual(0);
    expect(value.indexOf("AAA")).toBeLessThan(value.indexOf("BBB"));
    expect(value.indexOf("BBB")).toBeLessThan(value.indexOf("live draft"));
  });

  it("keeps restored top attachments in send order too", async () => {
    const h = harness(doc(para(text("a"))), [{ id: "t1" }]);
    const handleA = consume(h);
    h.top = [{ id: "t2" }];
    const handleB = consume(h);
    h.top = [{ id: "t3-added-later" }];

    await runSendWithConsumedCompose(
      () => false as SendResult,
      handleA.ids,
      handleA.compose,
    );
    await runSendWithConsumedCompose(
      () => false as SendResult,
      handleB.ids,
      handleB.compose,
    );

    expect(h.top.map((item) => item.id)).toEqual([
      "t1",
      "t2",
      "t3-added-later",
    ]);
  });
});
