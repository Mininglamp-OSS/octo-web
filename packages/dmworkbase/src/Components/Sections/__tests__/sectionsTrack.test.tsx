import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Sections from "../index";
import { Row, Section } from "../../../Service/Section";

vi.mock("../index.css", () => ({}));

const Cell = ({ title }: { title?: string }) => <span>{title}</span>;

/**
 * 护住 PR #1390 的 data-track 渲染契约(review P2-3):
 * 带 trackEvent 的行 wrapper 才挂 data-track / data-track-*;不带的行零属性(零回归)。
 */
describe("Sections data-track rendering", () => {
  it("emits data-track and data-track-* for a Row that sets trackEvent/trackProps", () => {
    const section = new Section({
      rows: [
        new Row({
          cell: Cell,
          trackEvent: "conversation_clear_dialog_opened",
          trackProps: { source: "danger", index: 2 },
          properties: { title: "clear" },
        }),
      ],
    });

    const { container } = render(<Sections sections={[section]} />);
    const wrapper = container.querySelector(".wk-section-row") as HTMLElement;

    expect(wrapper.getAttribute("data-track")).toBe(
      "conversation_clear_dialog_opened"
    );
    expect(wrapper.getAttribute("data-track-source")).toBe("danger");
    expect(wrapper.getAttribute("data-track-index")).toBe("2");
  });

  it("emits no track attributes for a Row without trackEvent", () => {
    const section = new Section({
      rows: [new Row({ cell: Cell, properties: { title: "plain" } })],
    });

    const { container } = render(<Sections sections={[section]} />);
    const wrapper = container.querySelector(".wk-section-row") as HTMLElement;

    const trackAttrs = wrapper
      .getAttributeNames()
      .filter((name) => name.startsWith("data-track"));
    expect(trackAttrs).toEqual([]);
  });
});
