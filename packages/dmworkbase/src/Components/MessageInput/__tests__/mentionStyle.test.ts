import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import TiptapMention from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  MENTION_UID_AIS,
  MENTION_UID_HUMANS,
  MENTION_UID_LEGACY_ALL,
} from "../../../Utils/mentionRender";

const cssPath = path.resolve(__dirname, "../index.css");
const css = fs.readFileSync(cssPath, "utf8");
const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const broadcastEditorUids = [
  MENTION_UID_LEGACY_ALL,
  MENTION_UID_HUMANS,
  MENTION_UID_AIS,
];

function blockFor(selector: string): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = match[1].split(",").map((item) => item.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return "";
}

function declarationsFor(selector: string): Record<string, string> {
  return Object.fromEntries(
    blockFor(selector)
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separatorIndex = declaration.indexOf(":");
        return [
          declaration.slice(0, separatorIndex).trim(),
          declaration.slice(separatorIndex + 1).trim(),
        ];
      }),
  );
}

function mentionBroadcastSelectors(): string[] {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const selectors: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    for (const selector of match[1].split(",").map((item) => item.trim())) {
      if (selector.startsWith(".wk-messageinput-editor .mention[data-id=")) {
        selectors.push(selector);
      }
    }
  }
  return selectors;
}

describe("MessageInput mention style", () => {
  it("renders ordinary member mentions as visible pills", () => {
    const declarations = declarationsFor(".wk-messageinput-editor .mention");

    expect(declarations.color).toBe("var(--wk-text-mention-entity)");
    expect(declarations["font-weight"]).toBe("500");
    expect(declarations["background-color"]).toBe("var(--wk-accent-tint-08)");
    expect(declarations["border-radius"]).toBe("var(--wk-r-mention-entity)");
    expect(declarations.padding).toBe("var(--wk-sp-0-5) var(--wk-sp-2)");
  });

  it("keeps broadcast mention sentinels as text-only highlights", () => {
    expect(mentionBroadcastSelectors().sort()).toEqual(
      broadcastEditorUids
        .map((uid) => `.wk-messageinput-editor .mention[data-id="${uid}"]`)
        .sort(),
    );

    for (const uid of broadcastEditorUids) {
      const selector = `.wk-messageinput-editor .mention[data-id="${uid}"]`;
      const declarations = declarationsFor(selector);

      expect(declarations.color).toBe(
        "var(--wk-text-accent, var(--wk-color-theme))",
      );
      expect(declarations["font-weight"]).toBe("400");
      expect(declarations["background-color"]).toBe("transparent");
      expect(declarations.padding).toBe("0 var(--wk-sp-0-5)");
    }
  });

  it("renders mention nodes with data-id for the CSS broadcast selectors", () => {
    const editor = new Editor({
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
        TiptapMention.configure({
          HTMLAttributes: { class: "mention" },
          renderText({ node }) {
            return `@${node.attrs.label ?? node.attrs.id}`;
          },
        }),
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: { id: MENTION_UID_HUMANS, label: "所有人" },
              },
            ],
          },
        ],
      },
    });

    const html = editor.getHTML();
    expect(html).toContain('class="mention"');
    expect(html).toContain('data-type="mention"');
    expect(html).toContain(`data-id="${MENTION_UID_HUMANS}"`);
    expect(html).toContain('data-label="所有人"');
    editor.destroy();
  });
});
