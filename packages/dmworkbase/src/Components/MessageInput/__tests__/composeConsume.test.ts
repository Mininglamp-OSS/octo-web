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
  composeSnapshotDraftText,
  composeSnapshotPreviewText,
  consumeCompose,
  buildComposeRecoveryDocument,
  ComposeRestoreUnavailableError,
  type ComposeDoc,
  type ComposeEditorPort,
  type TopAttachmentLike,
} from "../composeConsume";
import {
  createSendQueue,
  runSendWithConsumedCompose,
} from "../../../features/chat-composer/application/sendFlow";
import {
  createChatSendOutcome,
  type ChatSendOutcome,
} from "../../../features/chat-composer/domain";
import { EditorComposePartRegistry } from "../../../features/chat-composer/editor";
import { captureSendTarget } from "../../Conversation/sendTarget";
import { parseConsumedTextToContent } from "../mentionSendParse";

const outcome = (overrides: Partial<ChatSendOutcome> = {}) =>
  createChatSendOutcome(overrides);

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

const TestMention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: null }, label: { default: "" } };
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
  renderHTML({ node }) {
    return ["span", { "data-mention": node.attrs.id }, `@${node.attrs.label}`];
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
      TestMention,
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
  restoredSendTarget: number;
  takenEditorAttachments: string[];
  restoredEditorAttachments: string[];
  disposedEditorAttachments: string[];
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
    restoredSendTarget: 0,
    takenEditorAttachments: [],
    restoredEditorAttachments: [],
    disposedEditorAttachments: [],
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
    takeEditorAttachments: (ids) => {
      h.takenEditorAttachments.push(...ids);
    },
    restoreEditorAttachments: (ids) => {
      h.restoredEditorAttachments.push(...ids);
    },
    disposeEditorAttachment: (id, previewUrl) => {
      h.disposedEditorAttachments.push(id);
      h.files.delete(id);
      if (previewUrl) h.revoked.push(previewUrl);
    },
    snapshotTopAttachments: () => h.top,
    takeTopAttachments: (ids) => {
      const wanted = new Set(ids);
      h.top = h.top.filter(({ id }) => !wanted.has(id));
    },
    restoreTopAttachments: (items, offset) => {
      const liveIds = new Set(h.top.map(({ id }) => id));
      const fresh = items.filter(({ id }) => !liveIds.has(id));
      const index = Math.min(offset, h.top.length);
      h.top = [
        ...h.top.slice(0, index),
        ...fresh,
        ...h.top.slice(index),
      ];
      return fresh.length;
    },
    revokeObjectURL: (url) => h.revoked.push(url),
    parseTextToNodes: (value) =>
      parseConsumedTextToContent(value).content as ComposeDoc["content"] as never,
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
    onRestoreSendTarget: () => {
      h.restoredSendTarget += 1;
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

it("keeps the editor intact when a registered part has no settlement adapter", () => {
  const registry = new EditorComposePartRegistry();
  registry.register({
    id: "custom",
    canCapture: (node) => node.type === "custom",
    capture: (node) => ({
      id: "custom-1",
      kind: "custom",
      extensionId: "custom",
      node,
    }),
  });
  let cleared = false;

  expect(() =>
    consumeCompose({
      editor: {
        getJSON: () => ({ type: "doc", content: [{ type: "custom" }] }),
        isEmpty: () => false,
        isDestroyed: () => false,
        clearContent: () => {
          cleared = true;
        },
        setContent: () => undefined,
        insertContentAtBlock: () => undefined,
        appendContent: () => undefined,
        focusEnd: () => undefined,
      },
      composePartRegistry: registry,
      attachmentFiles: new Map(),
      snapshotTopAttachments: () => [],
      takeTopAttachments: () => undefined,
      restoreTopAttachments: () => 0,
    }),
  ).toThrow("cannot participate in send settlement");
  expect(cleared).toBe(false);
});

it("does not take top attachments when clearing the editor throws", () => {
  const top = [{ id: "top-1", previewUrl: "blob:top-1" }];
  const takeTopAttachments = vi.fn();

  expect(() =>
    consumeCompose({
      editor: {
        getJSON: () => ({ type: "doc", content: [] }),
        isEmpty: () => false,
        isDestroyed: () => false,
        clearContent: () => {
          throw new Error("clear failed");
        },
        setContent: () => undefined,
        insertContentAtBlock: () => undefined,
        appendContent: () => undefined,
        focusEnd: () => undefined,
      },
      attachmentFiles: new Map(),
      snapshotTopAttachments: () => top,
      takeTopAttachments,
      restoreTopAttachments: () => 0,
    }),
  ).toThrow("clear failed");
  expect(takeTopAttachments).not.toHaveBeenCalled();
});

describe("consumeCompose — the composer is emptied synchronously", () => {
  it("clears the editor and removes this send's top attachments before any await", () => {
    const h = harness(doc(para(text("hello"))), [
      { id: "t1", previewUrl: "blob:t1" },
    ]);

    const handle = consume(h);

    expect(h.editor.getText()).toBe("");
    expect(h.top).toEqual([]);
    expect(handle.ids.topIds).toEqual(["t1"]);
    expect(composeSnapshotDraftText(handle.snapshot)).toBe("hello");
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
    expect(h.takenEditorAttachments).toEqual(["img-1", "img-2"]);
  });
});

describe("consumeCompose — a send that was never enqueued gives the content back", () => {
  it("restores the original document when the composer is still empty", async () => {
    const h = harness(doc(para(text("retry me"))));
    const handle = consume(h);

    await runSendWithConsumedCompose(
      () => outcome(),
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
      () => outcome(),
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
      () => outcome(),
      handle.ids,
      handle.compose,
    );

    expect(h.editor.getJSON()).toEqual(
      expect.objectContaining({ type: "doc" }),
    );
    expect(JSON.stringify(h.editor.getJSON())).toContain("img-1");
    expect(h.files.has("img-1")).toBe(true);
    expect(h.revoked).toEqual([]);
    expect(h.restoredEditorAttachments).toEqual(["img-1"]);
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
      () => outcome({ editorConsumed: true, consumedTopIds: ["t1"] }),
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
      () =>
        outcome({
          editorConsumed: true,
          unsentEditorBlocks: [{ type: "attachment" as const, id: "img-2" }],
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
    expect(h.disposedEditorAttachments).toEqual(["img-1"]);
    expect(h.restoredEditorAttachments).toEqual(["img-2"]);
    // Sent text is NOT re-inserted — only the rejected attachment comes back.
    expect(h.editor.getText()).not.toContain("two pics");
  });

  it("reports an unknown attachment instead of silently losing its lease", async () => {
    const h = harness(doc(para(attachment("img-1", "blob:1"))));
    h.files.set("img-1", new File(["1"], "img-1.png", { type: "image/png" }));
    const handle = consume(h);

    await runSendWithConsumedCompose(
      () =>
        outcome({
          editorConsumed: true,
          unsentEditorBlocks: [
            { type: "attachment" as const, id: "unknown" },
          ],
        }),
      handle.ids,
      handle.compose,
    );

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].step).toBe("restoreEditorBlocks");
    expect(h.errors[0].err).toEqual(
      expect.objectContaining({
        message: "cannot restore unknown editor attachment: unknown",
      }),
    );
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
      () => outcome(),
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

describe("compose snapshot serialization", () => {
  it("keeps canonical mentions and whitespace in persisted drafts", () => {
    const snapshot = doc(
      para(
        text("  hi "),
        { type: "mention", attrs: { id: "u1", label: "Alice" } },
        { type: "hardBreak" },
        text("there  "),
        { type: "attachment", attrs: { id: "a" } },
      ),
      para(text("bye ")),
    ) as ComposeDoc;
    expect(composeSnapshotDraftText(snapshot)).toBe(
      "  hi @[u1:Alice]\nthere  \nbye ",
    );
    expect(composeSnapshotPreviewText(snapshot)).toBe(
      "hi @Alice\nthere  \nbye",
    );
  });

  it("returns an empty string for an empty compose", () => {
    expect(composeSnapshotDraftText(undefined)).toBe("");
    expect(composeSnapshotPreviewText({ type: "doc", content: [] })).toBe("");
  });
});

describe("consumeCompose — success leaves the composer alone", () => {
  it("does not touch a draft typed during the await", async () => {
    const h = harness(doc(para(text("sent text"))));
    const handle = consume(h);
    h.editor.commands.insertContent("brand new draft");

    const ok = await runSendWithConsumedCompose(
      () => outcome({ editorConsumed: true }),
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
      () => outcome(),
      handleA.ids,
      handleA.compose,
    );
    await runSendWithConsumedCompose(
      () => outcome(),
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
      () => outcome(),
      handleA.ids,
      handleA.compose,
    );
    await runSendWithConsumedCompose(
      () => outcome(),
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

describe("consumeCompose — text that failed before enqueue comes back (#1333 review)", () => {
  it("restores the unsent text while the block that was sent stays consumed", async () => {
    // Repro shape: a top attachment enqueues (anyMessageSent = true), then the
    // text block's send throws before enqueue. Reporting only
    // `editorConsumed: true` used to drop that text: the editor was already
    // cleared, so it existed nowhere.
    const h = harness(doc(para(text("this text must survive"))), [
      { id: "t1", previewUrl: "blob:t1" },
    ]);
    const handle = consume(h);

    const ok = await runSendWithConsumedCompose(
      () =>
        outcome({
          editorConsumed: true,
          consumedTopIds: ["t1"],
          unsentEditorBlocks: [
            { type: "text" as const, text: "this text must survive" },
          ],
        }),
      handle.ids,
      handle.compose,
    );

    expect(ok).toBe(true);
    expect(h.editor.getText()).toBe("this text must survive");
    // The attachment that did go out is not restored → retry cannot duplicate it.
    expect(h.top).toEqual([]);
    expect(h.revoked).toEqual(["blob:t1"]);
    expect(h.errors).toEqual([]);
  });

  it("restores a reply target and structured member mention on partial failure", async () => {
    const h = harness(doc(para(text("placeholder"))), [
      { id: "t1", previewUrl: "blob:t1" },
    ]);
    const handle = consume(h);

    await runSendWithConsumedCompose(
      () =>
        outcome({
          editorConsumed: true,
          consumedTopIds: ["t1"],
          unsentEditorBlocks: [
            { type: "text" as const, text: "@[u-alice:Alice] please retry" },
          ],
          restoreSendTarget: true,
        }),
      handle.ids,
      handle.compose,
    );

    expect(h.restoredSendTarget).toBe(1);
    expect(h.editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "u-alice", label: "Alice" } },
            { type: "text", text: " please retry" },
          ],
        },
      ],
    });
  });

  it("restores mixed unsent text and attachments in document order", async () => {
    const h = harness(
      doc(
        para(text("caption")),
        para(attachment("img-1", "blob:1"), attachment("img-2", "blob:2")),
        para(text("tail")),
      ),
    );
    h.files.set("img-1", new File(["1"], "img-1.png", { type: "image/png" }));
    h.files.set("img-2", new File(["2"], "img-2.png", { type: "image/png" }));
    const handle = consume(h);

    // img-1 went out; the caption, img-2 and the tail did not.
    await runSendWithConsumedCompose(
      () =>
        outcome({
          editorConsumed: true,
          unsentEditorBlocks: [
            { type: "text" as const, text: "caption" },
            { type: "attachment" as const, id: "img-2" },
            { type: "text" as const, text: "tail" },
          ],
        }),
      handle.ids,
      handle.compose,
    );

    const value = h.editor.getText();
    expect(value).toContain("caption");
    expect(value).toContain("tail");
    expect(value.indexOf("caption")).toBeLessThan(value.indexOf("tail"));
    const json = JSON.stringify(h.editor.getJSON());
    expect(json).toContain("img-2");
    expect(json).not.toContain("img-1");
    expect(h.files.has("img-2")).toBe(true);
    expect(h.files.has("img-1")).toBe(false);
  });

  it("does not restore empty text blocks", async () => {
    const h = harness(doc(para(text("x"))));
    const handle = consume(h);

    await runSendWithConsumedCompose(
      () =>
        outcome({
          editorConsumed: true,
          unsentEditorBlocks: [{ type: "text" as const, text: "   " }],
        }),
      handle.ids,
      handle.compose,
    );

    expect(h.editor.getText()).toBe("");
  });

  it("captures enough state to recover a consumed compose after editor destruction", () => {
    const h = harness(
      doc(
        para(text("caption")),
        para(attachment("img-1", "blob:img-1")),
      ),
      [{ id: "top-1", previewUrl: "blob:top-1" }],
    );
    h.files.set("img-1", new File(["1"], "img-1.png", { type: "image/png" }));

    const handle = consume(h);

    expect(handle.recovery.snapshot).toEqual(handle.snapshot);
    expect(handle.recovery.editorAttachments).toEqual([
      expect.objectContaining({ id: "img-1" }),
    ]);
    expect(handle.recovery.editorObjectUrls).toEqual([
      { id: "img-1", url: "blob:img-1" },
    ]);
    expect(handle.recovery.topAttachments).toEqual([
      { id: "top-1", previewUrl: "blob:top-1" },
    ]);
  });

  it("rebuilds only unsent editor blocks for recovery after a partial send", () => {
    const h = harness(
      doc(
        para(text("caption")),
        para(attachment("img-1", "blob:img-1")),
        para(text("tail")),
      ),
    );
    h.files.set("img-1", new File(["1"], "img-1.png", { type: "image/png" }));
    const handle = consume(h);

    const recovered = buildComposeRecoveryDocument(
      handle.recovery,
      [
        { type: "text", text: "caption" },
        { type: "text", text: "tail" },
      ],
      (value) => parseConsumedTextToContent(value).content as never,
    );

    expect(JSON.stringify(recovered)).toContain("caption");
    expect(JSON.stringify(recovered)).toContain("tail");
    expect(JSON.stringify(recovered)).not.toContain("img-1");
  });

  it("fails closed when recovery references an unknown attachment", () => {
    const h = harness(doc(para(attachment("img-1", "blob:img-1"))));
    h.files.set("img-1", new File(["1"], "img-1.png", { type: "image/png" }));
    const handle = consume(h);

    expect(() =>
      buildComposeRecoveryDocument(
        handle.recovery,
        [{ type: "attachment", id: "unknown" }],
        (value) => parseConsumedTextToContent(value).content as never,
      ),
    ).toThrow("cannot recover unknown editor attachment: unknown");
  });
});
