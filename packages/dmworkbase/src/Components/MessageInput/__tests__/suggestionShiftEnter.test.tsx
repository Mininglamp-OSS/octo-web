/**
 * @vitest-environment jsdom
 */

import { Editor } from "@tiptap/core";
import TiptapMention from "@tiptap/extension-mention";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { createMentionSuggestion } from "../../../features/chat-composer/adapters/tiptap/mentionSuggestion";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("tippy.js", () => ({
  default: () => [
    {
      destroy: vi.fn(),
      hide: vi.fn(),
      setProps: vi.fn(),
      show: vi.fn(),
    },
  ],
}));

const mentionItems = [{ uid: "uid-1", name: "Alice", icon: "avatar://alice" }];
const TestEditorContent = EditorContent as any;

let container: HTMLDivElement;
let editor: Editor;
let mentionActiveChange: Mock<(active: boolean) => void>;
let mentionCommand: Mock<(props: any) => void>;

function countNodesOfType(node: any, type: string): number {
  return (
    (node.type === type ? 1 : 0) +
    (node.content || []).reduce(
      (count: number, child: any) => count + countNodesOfType(child, type),
      0
    )
  );
}

function createEditor() {
  const suggestion = {
    ...createMentionSuggestion(
      ({ query }) => (query === "a" ? mentionItems : []),
      mentionActiveChange
    ),
    command: mentionCommand,
  } as any;

  editor = new Editor({
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
        suggestion,
      }),
    ],
    content: "",
  });

  act(() => {
    ReactDOM.render(<TestEditorContent editor={editor} />, container);
  });
}

function pressEnter(shiftKey: boolean) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    shiftKey,
  });

  act(() => {
    editor.view.dom.dispatchEvent(event);
  });

  return event;
}

async function setLongMentionQuery(value: string) {
  await act(async () => {
    editor.commands.setContent(value);
    editor.commands.setTextSelection(editor.state.doc.content.size);
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mentionActiveChange = vi.fn<(active: boolean) => void>();
  mentionCommand = vi.fn<(props: any) => void>();
  createEditor();
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  editor.destroy();
  container.remove();
});

describe("MessageInput suggestion Shift+Enter", () => {
  it("inserts a hard break in long text while a mention candidate is visible", async () => {
    await setLongMentionQuery(`${"x".repeat(48)} @a`);

    expect(mentionActiveChange).toHaveBeenCalledWith(true);
    expect(editor.getText()).toHaveLength(51);

    const event = pressEnter(true);

    expect(event.defaultPrevented).toBe(true);
    expect(countNodesOfType(editor.getJSON(), "hardBreak")).toBe(1);
    expect(countNodesOfType(editor.getJSON(), "mention")).toBe(0);
    expect(mentionCommand).not.toHaveBeenCalled();
  });

  it("inserts a hard break after a long mention query hides all candidates", async () => {
    await setLongMentionQuery(`${"x".repeat(47)} @a`);

    await act(async () => {
      editor.commands.insertContent("z");
      await Promise.resolve();
    });

    expect(mentionActiveChange).toHaveBeenLastCalledWith(false);
    expect(editor.getText()).toHaveLength(51);

    const event = pressEnter(true);

    expect(event.defaultPrevented).toBe(true);
    expect(countNodesOfType(editor.getJSON(), "hardBreak")).toBe(1);
    expect(countNodesOfType(editor.getJSON(), "mention")).toBe(0);
    expect(mentionCommand).not.toHaveBeenCalled();
  });

  it("keeps plain Enter selecting a visible mention candidate", async () => {
    await setLongMentionQuery(`${"x".repeat(48)} @a`);

    expect(mentionActiveChange).toHaveBeenCalledWith(true);

    const event = pressEnter(false);

    expect(event.defaultPrevented).toBe(true);
    expect(mentionCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        props: { id: "uid-1", label: "Alice" },
      })
    );
    expect(countNodesOfType(editor.getJSON(), "hardBreak")).toBe(0);
  });
});
