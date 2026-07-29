/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TiptapMention from "@tiptap/extension-mention";
import { isBroadcastSentinelUid } from "../../../Utils/mentionRender";

function createMentionEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({
        paragraph: { HTMLAttributes: {} },
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        hardBreak: false,
      }),
      TiptapMention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: {} as any,
        renderHTML({ options, node }) {
          const uid = String(node.attrs.id ?? "");
          const isBroadcast = isBroadcastSentinelUid(uid);
          const extraClass = isBroadcast ? "" : " mention-user";
          return [
            "span",
            { ...options.HTMLAttributes, class: `mention${extraClass}` },
            `@${node.attrs.label ?? node.attrs.id}`,
          ];
        },
      }),
    ],
  });
}

describe("Mention renderHTML class distinction", () => {
  it("普通成员 mention 渲染包含 mention-user class 并带 data-id/data-label", () => {
    const editor = createMentionEditor();
    editor.commands.insertContent({
      type: "mention",
      attrs: { id: "user123", label: "Alice" },
    });
    const html = editor.getHTML();
    editor.destroy();

    expect(html).toContain('data-type="mention"');
    expect(html).toContain('data-id="user123"');
    expect(html).toContain('data-label="Alice"');
    expect(html).toContain("mention-user");
    expect(html).toContain("@Alice");
    expect(html).not.toMatch(/class="mention"\s*[^u]|<span[^>]*class="mention"[^-]/);
  });

  it("@所有人(-2) 广播 mention 不包含 mention-user class", () => {
    const editor = createMentionEditor();
    editor.commands.insertContent({
      type: "mention",
      attrs: { id: "-2", label: "所有人" },
    });
    const html = editor.getHTML();
    editor.destroy();

    expect(html).toContain('class="mention"');
    expect(html).not.toContain("mention-user");
    expect(html).toContain("@所有人");
  });

  it("@所有AI(-3) 广播 mention 不包含 mention-user class", () => {
    const editor = createMentionEditor();
    editor.commands.insertContent({
      type: "mention",
      attrs: { id: "-3", label: "所有AI" },
    });
    const html = editor.getHTML();
    editor.destroy();

    expect(html).toContain('class="mention"');
    expect(html).not.toContain("mention-user");
  });

  it("legacy @all(-1) 和 render-all 均为 broadcast，不含 mention-user", () => {
    for (const id of ["-1", "all"]) {
      const editor = createMentionEditor();
      editor.commands.insertContent({
        type: "mention",
        attrs: { id, label: id },
      });
      const html = editor.getHTML();
      editor.destroy();
      expect(html).not.toContain("mention-user");
    }
  });
});
