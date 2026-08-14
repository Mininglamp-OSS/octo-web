/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmojiSuggestionList from "../EmojiSuggestionList";

const items = [
  {
    key: "[使命必达]",
    label: "使命必达",
    image: "emoji://mission",
  },
];

let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

function renderEmojiSuggestionList(command = vi.fn(), nextItems = items) {
  const ref = React.createRef<any>();

  act(() => {
    ReactDOM.render(
      <EmojiSuggestionList ref={ref} items={nextItems} command={command} />,
      container
    );
  });

  return { command, ref };
}

describe("EmojiSuggestionList keyboard handling", () => {
  it("keeps plain Enter selecting the active emoji", () => {
    const command = vi.fn();
    const { ref } = renderEmojiSuggestionList(command);

    let handled: boolean | undefined;
    act(() => {
      handled = ref.current.onKeyDown({
        event: { key: "Enter", shiftKey: false },
      });
    });

    expect(handled).toBe(true);
    expect(command).toHaveBeenCalledWith(items[0]);
  });

  it("lets Shift+Enter fall through without selecting an emoji", () => {
    const command = vi.fn();
    const { ref } = renderEmojiSuggestionList(command);

    let handled: boolean | undefined;
    act(() => {
      handled = ref.current.onKeyDown({
        event: { key: "Enter", shiftKey: true },
      });
    });

    expect(handled).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });

  it("lets Shift+Enter fall through when no emoji result is visible", () => {
    const command = vi.fn();
    const { ref } = renderEmojiSuggestionList(command, []);

    let handled: boolean | undefined;
    act(() => {
      handled = ref.current.onKeyDown({
        event: { key: "Enter", shiftKey: true },
      });
    });

    expect(handled).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });
});

describe("EmojiSuggestionList pointer handling", () => {
  it("keeps the editor focused while selecting with the mouse", () => {
    const command = vi.fn();
    renderEmojiSuggestionList(command);
    const option = container.querySelector(
      ".emoji-suggestion-cell"
    ) as HTMLElement;
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    act(() => {
      option.dispatchEvent(mouseDown);
      option.click();
    });

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(command).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledWith(items[0]);
  });
});
