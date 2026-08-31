/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FoldSessionExpandedList from "../FoldSessionExpandedList";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

const dispatchContextMenu = (element: Element) => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  act(() => element.dispatchEvent(event));
  return event;
};

describe("FoldSessionExpandedList context-menu boundary", () => {
  it("opens from the whole message row and supports the keyboard context-menu shortcut", () => {
    const onMessageContextMenu = vi.fn();
    const message = {
      clientMsgNo: "fold-1",
      messageSeq: 1,
      timestamp: 1,
      fromUID: "user-1",
      contentType: 1,
      revoke: false,
      checked: false,
      message: { clientMsgNo: "fold-1" },
    } as any;

    act(() => {
      ReactDOM.render(
        <FoldSessionExpandedList
          messages={[message]}
          editMode={false}
          renderAvatar={() => <button type="button">avatar</button>}
          renderMessageContent={() => <span>message body</span>}
          onToggleSelect={vi.fn()}
          onMessageContextMenu={onMessageContextMenu}
        />,
        container,
      );
    });

    dispatchContextMenu(container.querySelector(".wk-fold-msg-ava")!);
    dispatchContextMenu(container.querySelector(".wk-fold-msg-head")!);
    expect(onMessageContextMenu).toHaveBeenCalledTimes(2);

    const content = container.querySelector<HTMLElement>(".wk-fold-msg-content")!;
    dispatchContextMenu(content);
    expect(onMessageContextMenu).toHaveBeenCalledTimes(3);

    act(() => content.focus());
    act(() => content.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })));
    expect(onMessageContextMenu).toHaveBeenCalledTimes(4);
    expect((onMessageContextMenu.mock.calls[3][1].nativeEvent as MouseEvent & {
      focusFirstItem?: boolean;
    }).focusFirstItem).toBe(true);
  });
});
