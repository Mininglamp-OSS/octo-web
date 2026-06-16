/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { fireEvent } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MentionList from "../MentionList";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const items = [
  { uid: "uid-1", name: "Alice", icon: "avatar://alice" },
  { uid: "uid-2", name: "Bob", icon: "avatar://bob" },
  { uid: "uid-3", name: "Carol", icon: "avatar://carol" },
];

let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

function renderMentionList(command = vi.fn(), nextItems = items) {
  const ref = React.createRef<any>();

  act(() => {
    ReactDOM.render(
      <MentionList ref={ref} items={nextItems} command={command} />,
      container
    );
  });

  return { command, ref };
}

function listElement() {
  return container.querySelector(".mention-list") as HTMLElement;
}

function optionElements() {
  return Array.from(container.querySelectorAll(".mention-list-item")) as HTMLElement[];
}

function setListViewport(height: number, scrollTop: number, scrollHeight: number) {
  const list = listElement();
  Object.defineProperty(list, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(list, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  list.scrollTop = scrollTop;
}

function setOptionLayout(index: number, offsetTop: number, offsetHeight: number) {
  const option = optionElements()[index];
  Object.defineProperty(option, "offsetTop", {
    configurable: true,
    value: offsetTop,
  });
  Object.defineProperty(option, "offsetHeight", {
    configurable: true,
    value: offsetHeight,
  });
}

describe("MentionList interaction mode", () => {
  it("starts in keyboard mode with the first item selected", () => {
    renderMentionList();

    const list = listElement();
    const options = optionElements();

    expect(list.className).toContain("mention-list--keyboard");
    expect(options[0].className).toContain("is-selected");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].className).not.toContain("is-selected");
  });

  it("switches to mouse mode on pointer movement and uses click for mouse selection", () => {
    const command = vi.fn();
    renderMentionList(command);
    const options = optionElements();

    act(() => {
      fireEvent.mouseMove(options[1]);
    });

    expect(listElement().className).toContain("mention-list--mouse");
    expect(optionElements().some((option) => option.className.includes("is-selected"))).toBe(false);
    expect(optionElements().map((option) => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
    ]);

    act(() => {
      fireEvent.click(options[1]);
    });

    expect(command).toHaveBeenCalledWith({ id: "uid-2", label: "Bob" });
  });

  it("uses the hovered item as the keyboard starting point", () => {
    const command = vi.fn();
    const { ref } = renderMentionList(command);
    const options = optionElements();

    act(() => {
      fireEvent.mouseMove(options[1]);
    });

    act(() => {
      ref.current.onKeyDown({ event: { key: "Enter" } });
    });

    expect(command).toHaveBeenCalledWith({ id: "uid-2", label: "Bob" });

    command.mockClear();

    act(() => {
      fireEvent.mouseMove(optionElements()[1]);
    });

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });

    expect(listElement().className).toContain("mention-list--keyboard");
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      ref.current.onKeyDown({ event: { key: "Enter" } });
    });

    expect(command).toHaveBeenCalledWith({ id: "uid-3", label: "Carol" });
  });

  it("ignores scroll-induced hover until the pointer really moves", () => {
    const { ref } = renderMentionList();

    act(() => {
      fireEvent.mouseMove(optionElements()[1], { clientX: 12, clientY: 12 });
    });
    expect(listElement().className).toContain("mention-list--mouse");

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });
    expect(listElement().className).toContain("mention-list--keyboard");
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      fireEvent.mouseEnter(optionElements()[0], { clientX: 12, clientY: 12 });
      fireEvent.mouseMove(optionElements()[0], { clientX: 12, clientY: 12 });
    });
    expect(listElement().className).toContain("mention-list--keyboard");
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      fireEvent.mouseMove(optionElements()[0], {
        clientX: 24,
        clientY: 12,
      });
    });
    expect(listElement().className).toContain("mention-list--mouse");
    expect(optionElements().some((option) => option.className.includes("is-selected"))).toBe(false);
  });

  it("uses mouse hover as the keyboard starting point only when switching modes", () => {
    const { ref } = renderMentionList();

    act(() => {
      fireEvent.mouseMove(optionElements()[1], { clientX: 12, clientY: 12 });
    });

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      fireEvent.mouseEnter(optionElements()[1], { clientX: 12, clientY: 12 });
      fireEvent.mouseMove(optionElements()[1], { clientX: 12, clientY: 12 });
    });

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowUp" } });
    });
    expect(optionElements()[1].className).toContain("is-selected");
  });

  it("keeps keyboard origin after scroll-induced hover before the next key", () => {
    const { ref } = renderMentionList();

    act(() => {
      fireEvent.mouseMove(optionElements()[1], { clientX: 12, clientY: 12 });
    });

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      fireEvent.mouseEnter(optionElements()[0], { clientX: 12, clientY: 12 });
      fireEvent.mouseMove(optionElements()[0], { clientX: 12, clientY: 12 });
    });
    expect(listElement().className).toContain("mention-list--keyboard");
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowUp" } });
    });
    expect(optionElements()[1].className).toContain("is-selected");
  });

  it("updates the pointer baseline while moving within the same hovered item", () => {
    const { ref } = renderMentionList();

    act(() => {
      fireEvent.mouseMove(optionElements()[1], { clientX: 12, clientY: 12 });
      fireEvent.mouseMove(optionElements()[1], { clientX: 80, clientY: 12 });
    });

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      fireEvent.mouseEnter(optionElements()[0], { clientX: 80, clientY: 12 });
      fireEvent.mouseMove(optionElements()[0], { clientX: 80, clientY: 12 });
    });
    expect(listElement().className).toContain("mention-list--keyboard");
    expect(optionElements()[2].className).toContain("is-selected");

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowUp" } });
    });
    expect(optionElements()[1].className).toContain("is-selected");
  });

  it("keeps keyboard boundary wrapping", () => {
    const command = vi.fn();
    const { ref } = renderMentionList(command);

    setListViewport(40, 0, 60);
    setOptionLayout(0, 0, 20);
    setOptionLayout(1, 20, 20);
    setOptionLayout(2, 40, 20);

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowUp" } });
    });
    expect(optionElements()[2].className).toContain("is-selected");
    expect(listElement().scrollTop).toBe(20);

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });
    expect(optionElements()[0].className).toContain("is-selected");
    expect(listElement().scrollTop).toBe(0);

    act(() => {
      ref.current.onKeyDown({ event: { key: "Enter" } });
    });
    expect(command).toHaveBeenCalledWith({ id: "uid-1", label: "Alice" });
  });

  it("returns to the first keyboard item after the pointer leaves the list", () => {
    const command = vi.fn();
    const { ref } = renderMentionList(command);

    act(() => {
      fireEvent.mouseMove(optionElements()[1]);
    });
    act(() => {
      fireEvent.mouseOut(listElement(), { relatedTarget: document.body });
    });

    expect(listElement().className).toContain("mention-list--keyboard");
    expect(optionElements()[0].className).toContain("is-selected");

    act(() => {
      ref.current.onKeyDown({ event: { key: "Enter" } });
    });

    expect(command).toHaveBeenCalledWith({ id: "uid-1", label: "Alice" });
  });

  it("aligns keyboard scrolling to the lower or upper viewport edge", () => {
    const { ref } = renderMentionList();

    setListViewport(40, 0, 60);
    setOptionLayout(0, 0, 20);
    setOptionLayout(1, 20, 20);
    setOptionLayout(2, 40, 20);

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });
    expect(listElement().scrollTop).toBe(0);

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowDown" } });
    });
    expect(listElement().scrollTop).toBe(20);

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowUp" } });
    });
    expect(listElement().scrollTop).toBe(20);

    act(() => {
      ref.current.onKeyDown({ event: { key: "ArrowUp" } });
    });
    expect(listElement().scrollTop).toBe(0);
  });
});
