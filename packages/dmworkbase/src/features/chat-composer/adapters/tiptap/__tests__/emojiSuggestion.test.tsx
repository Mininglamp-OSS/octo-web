/** @vitest-environment jsdom */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  tippy: vi.fn(),
  popups: [] as Array<{
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setProps: ReturnType<typeof vi.fn>;
  }>,
  renderers: [] as Array<{
    props: any;
    updateProps: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  deferItems: false,
  itemRequests: [] as Array<{
    query: string;
    resolve: () => void;
  }>,
}));

vi.mock("../../../../../Utils/emojiSuggestion", () => ({
  matchEmojiPrefix: (text: string) => {
    const matched = text.match(/([\u4e00-\u9fff]+)$/);
    return matched
      ? { query: matched[1], items: [{ key: "[使命必达]" }] }
      : null;
  },
  buildEmojiSuggestItems: (query: string) => {
    const items = query
      ? [{ key: "[使命必达]", label: "使命必达", image: "emoji://mission" }]
      : [];
    if (!mocks.deferItems) return items;
    return new Promise((resolve) => {
      mocks.itemRequests.push({
        query,
        resolve: () => resolve(items),
      });
    });
  },
}));

vi.mock("@tiptap/react", () => ({
  ReactRenderer: class MockReactRenderer {
    element = document.createElement("div");
    ref = { onKeyDown: vi.fn(() => false) };
    props: any;
    updateProps = vi.fn((props: any) => {
      this.props = props;
    });
    destroy = vi.fn();

    constructor(_component: unknown, options: { props: any }) {
      this.props = options.props;
      mocks.renderers.push(this);
    }
  },
}));

vi.mock("tippy.js", () => ({
  default: (...args: unknown[]) => {
    mocks.tippy(...args);
    const popup = {
      show: vi.fn(),
      hide: vi.fn(),
      destroy: vi.fn(),
      setProps: vi.fn(),
    };
    mocks.popups.push(popup);
    return [popup];
  },
}));

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { createEmojiSuggestionExtension } from "../emojiSuggestion";

const item = {
  key: "[使命必达]",
  label: "使命必达",
  image: "emoji://mission",
};

let editor: Editor;
let element: HTMLDivElement;

const originalRangeGetClientRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects"
);
const originalRangeGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect"
);

beforeAll(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: {
      configurable: true,
      value: () => [],
    },
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(),
    },
  });
});

afterAll(() => {
  if (originalRangeGetClientRects) {
    Object.defineProperty(
      Range.prototype,
      "getClientRects",
      originalRangeGetClientRects
    );
  } else {
    delete (Range.prototype as any).getClientRects;
  }
  if (originalRangeGetBoundingClientRect) {
    Object.defineProperty(
      Range.prototype,
      "getBoundingClientRect",
      originalRangeGetBoundingClientRect
    );
  } else {
    delete (Range.prototype as any).getBoundingClientRect;
  }
});

const flushSuggestionUpdates = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.popups.length = 0;
  mocks.renderers.length = 0;
  mocks.deferItems = false;
  mocks.itemRequests.length = 0;
  element = document.createElement("div");
  document.body.appendChild(element);
});

afterEach(() => {
  editor?.destroy();
  element.remove();
});

function createEditor(onActiveChange = vi.fn()) {
  editor = new Editor({
    element,
    extensions: [StarterKit, createEmojiSuggestionExtension(onActiveChange)],
  });
  return onActiveChange;
}

describe("emoji suggestion popup lifecycle", () => {
  it("ignores a stale start that resolves after the suggestion exits", async () => {
    const onActiveChange = createEditor();

    editor.commands.insertContent("使命");
    editor.commands.clearContent();
    await flushSuggestionUpdates();

    expect(mocks.tippy).not.toHaveBeenCalled();
    expect(mocks.renderers).toHaveLength(0);
    expect(onActiveChange).not.toHaveBeenCalledWith(true);
  });

  it("does not show the popup again after selecting an emoji", async () => {
    const onActiveChange = createEditor();
    editor.commands.insertContent("使命");
    await flushSuggestionUpdates();

    expect(mocks.popups).toHaveLength(1);
    expect(mocks.popups[0].show).toHaveBeenCalledOnce();
    expect(onActiveChange).toHaveBeenCalledWith(true);
    expect(mocks.tippy).toHaveBeenCalledWith(
      "body",
      expect.objectContaining({ hideOnClick: false })
    );

    mocks.renderers[0].props.command(item);
    await flushSuggestionUpdates();
    await flushSuggestionUpdates();

    expect(editor.getText()).toBe("[使命必达]");
    expect(mocks.popups[0].show).toHaveBeenCalledOnce();
    expect(mocks.popups[0].hide).toHaveBeenCalledOnce();
    expect(mocks.popups[0].destroy).toHaveBeenCalledOnce();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("does not revive the popup when an older update resolves after selection", async () => {
    createEditor();
    editor.commands.insertContent("使命");
    await flushSuggestionUpdates();

    mocks.deferItems = true;
    editor.commands.insertContent("必");
    expect(mocks.itemRequests).toHaveLength(1);

    mocks.renderers[0].props.command(item);
    expect(mocks.popups[0].destroy).toHaveBeenCalledOnce();

    mocks.itemRequests[0].resolve();
    await flushSuggestionUpdates();

    expect(mocks.popups).toHaveLength(1);
    expect(mocks.popups[0].show).toHaveBeenCalledOnce();
    expect(mocks.popups[0].destroy).toHaveBeenCalledOnce();
  });

  it("ignores an older moved exit after the current suggestion updates", async () => {
    createEditor();
    editor.commands.insertContent("使命");
    await flushSuggestionUpdates();

    mocks.deferItems = true;
    const moved = editor.state.tr.insertText("x", 1);
    moved.insertText("必", moved.doc.content.size - 1);
    moved.setSelection(TextSelection.atEnd(moved.doc));
    editor.view.dispatch(moved);
    editor.commands.insertContent("达");
    expect(mocks.itemRequests).toHaveLength(2);

    mocks.itemRequests[1].resolve();
    await flushSuggestionUpdates();
    mocks.itemRequests[0].resolve();
    await flushSuggestionUpdates();

    expect(mocks.popups).toHaveLength(1);
    expect(mocks.popups[0].show).toHaveBeenCalledOnce();
    expect(mocks.popups[0].destroy).not.toHaveBeenCalled();
  });

  it("releases an active popup when the editor is destroyed", async () => {
    const onActiveChange = createEditor();
    editor.commands.insertContent("使命");
    await flushSuggestionUpdates();

    expect(mocks.popups).toHaveLength(1);
    expect(mocks.popups[0].show).toHaveBeenCalledOnce();

    editor.destroy();

    expect(mocks.popups[0].hide).toHaveBeenCalledOnce();
    expect(mocks.popups[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.renderers[0].destroy).toHaveBeenCalledOnce();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("releases an active popup when the editor is unmounted", async () => {
    const onActiveChange = createEditor();
    editor.commands.insertContent("使命");
    await flushSuggestionUpdates();

    editor.unmount();

    expect(mocks.popups[0].hide).toHaveBeenCalledOnce();
    expect(mocks.popups[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.renderers[0].destroy).toHaveBeenCalledOnce();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("does not create a popup when pending items resolve after editor destroy", async () => {
    mocks.deferItems = true;
    createEditor();
    editor.commands.insertContent("使命");
    expect(mocks.itemRequests).toHaveLength(1);

    editor.destroy();
    mocks.itemRequests[0].resolve();
    await flushSuggestionUpdates();

    expect(mocks.renderers).toHaveLength(0);
    expect(mocks.popups).toHaveLength(0);
  });

  it("invalidates pending items across unmount and remount", async () => {
    mocks.deferItems = true;
    createEditor();
    editor.commands.insertContent("使命");
    expect(mocks.itemRequests).toHaveLength(1);

    editor.unmount();
    editor.mount(element);
    mocks.itemRequests[0].resolve();
    await flushSuggestionUpdates();

    expect(mocks.renderers).toHaveLength(0);
    expect(mocks.popups).toHaveLength(0);

    mocks.deferItems = false;
    editor.commands.insertContent("必");
    await flushSuggestionUpdates();

    expect(mocks.renderers).toHaveLength(1);
    expect(mocks.popups).toHaveLength(1);
    expect(mocks.popups[0].show).toHaveBeenCalledOnce();
  });
});
