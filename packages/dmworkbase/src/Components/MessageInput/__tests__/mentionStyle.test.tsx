/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TiptapMention from "@tiptap/extension-mention";
import { readFileSync } from "fs";
import path from "path";
import { isBroadcastSentinelUid } from "../../../Utils/mentionRender";

const cssPath = path.resolve(__dirname, "../index.css");
const css = readFileSync(cssPath, "utf-8");

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
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        },
      }),
    ],
  });
}

describe("Mention CSS capsule style", () => {
  it(".wk-messageinput-editor .mention 有浅紫胶囊背景（非 transparent）", () => {
    const match = css.match(
      /\.wk-messageinput-editor \.mention\s*{([^}]*)}/,
    );
    expect(match, ".wk-messageinput-editor .mention 规则应存在").not.toBeNull();
    const block = match![1];
    expect(block).toMatch(/background-color\s*:\s*var\(--wk-purple-alpha-08\)/);
    expect(block).toMatch(/color\s*:\s*var\(--wk-color-accent\)/);
    expect(block).toMatch(/padding\s*:\s*var\(--wk-sp-px\)\s+var\(--wk-sp-2\)/);
    expect(block).not.toMatch(/background-color\s*:\s*transparent/);
    expect(block).not.toMatch(/transition/);
  });

  it(".wk-messageinput-editor .mention 无 :hover 态（cursor:text 不响应 hover）", () => {
    expect(css).not.toMatch(/\.wk-messageinput-editor \.mention:hover/);
  });
});

describe("Mention DOM rendering (default renderer with renderText)", () => {
  it("普通成员 mention 渲染出 class=mention + data-id/data-label", () => {
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

  it("@所有人(-2) 广播 mention 同样渲染 class=mention（与展示层 .mention-entity 一致）", () => {
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

  it("@所有AI(-3)、legacy -1、all 均为 broadcast sentinel 且 class=mention", () => {
    for (const [id, label] of [
      ["-3", "所有AI"],
      ["-1", "所有人"],
      ["all", "所有人"],
    ] as const) {
      const editor = createMentionEditor();
      editor.commands.insertContent({
        type: "mention",
        attrs: { id, label },
      });
      const html = editor.getHTML();
      editor.destroy();
      expect(html).toContain('class="mention"');
      expect(isBroadcastSentinelUid(id)).toBe(true);
    }
  });
});
