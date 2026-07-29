/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TiptapMention from "@tiptap/extension-mention";
import { mentionNodeClass, isBroadcastSentinelUid } from "../../../Utils/mentionRender";

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
          const baseClass = options.HTMLAttributes?.class ?? "mention";
          const cls = mentionNodeClass(uid, baseClass);
          return [
            "span",
            { ...options.HTMLAttributes, class: cls },
            `@${node.attrs.label ?? node.attrs.id}`,
          ];
        },
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        },
      }),
    ],
  });
}

describe("Mention renderHTML", () => {
  it("普通成员 mention 渲染为 mention class 并带 data-id/data-label", () => {
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
    expect(html).toContain('class="mention"');
    expect(html).toContain("@Alice");
    expect(isBroadcastSentinelUid("user123")).toBe(false);
  });

  it("@所有人(-2) 广播 mention 同样渲染为 mention class（与展示层一致）", () => {
    const editor = createMentionEditor();
    editor.commands.insertContent({
      type: "mention",
      attrs: { id: "-2", label: "所有人" },
    });
    const html = editor.getHTML();
    editor.destroy();

    expect(html).toContain('class="mention"');
    expect(html).toContain("@所有人");
    expect(isBroadcastSentinelUid("-2")).toBe(true);
  });

  it("@所有AI(-3) 广播 mention 同样渲染为 mention class", () => {
    const editor = createMentionEditor();
    editor.commands.insertContent({
      type: "mention",
      attrs: { id: "-3", label: "所有AI" },
    });
    const html = editor.getHTML();
    editor.destroy();

    expect(html).toContain('class="mention"');
    expect(isBroadcastSentinelUid("-3")).toBe(true);
  });

  it("legacy -1 和 render-all 均为 broadcast sentinel，class 为 mention", () => {
    for (const id of ["-1", "all"]) {
      const editor = createMentionEditor();
      editor.commands.insertContent({
        type: "mention",
        attrs: { id, label: id },
      });
      const html = editor.getHTML();
      editor.destroy();
      expect(html).toContain('class="mention"');
      expect(isBroadcastSentinelUid(id)).toBe(true);
    }
  });

  it("mentionNodeClass 对所有 uid 统一返回 baseClass（广播/普通成员视觉一致）", () => {
    expect(mentionNodeClass("user123", "mention")).toBe("mention");
    expect(mentionNodeClass("-2", "mention")).toBe("mention");
    expect(mentionNodeClass("-3", "mention")).toBe("mention");
    expect(mentionNodeClass("-1", "mention")).toBe("mention");
    expect(mentionNodeClass("all", "mention")).toBe("mention");
  });
});
