// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

vi.mock("lucide-react", () => ({
  Lock: () => <span data-testid="lock-icon" />,
}));
vi.mock("../../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, opts?: { values?: Record<string, unknown> }) =>
      opts?.values ? `${key}:${JSON.stringify(opts.values)}` : key,
  }),
}));
vi.mock("../../../Checkbox", () => ({
  default: ({
    checked,
    onCheck,
    ariaLabel,
  }: {
    checked?: boolean;
    onCheck?: () => void;
    ariaLabel?: string;
  }) => (
    <div
      role="checkbox"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      onClick={() => onCheck?.()}
    />
  ),
}));

import { GrantArea } from "../GrantArea";
import type { ForwardGrantConfig } from "../../grant";

/** Many creators, mirroring the reported bug (grant area grew one row per selected person). */
function manyGroups(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    uid: `u_${i}`,
    name: `Person ${i}`,
    bots: [{ uid: `b_${i}`, name: `Bot ${i}`, selected: true }],
  }));
}

function config(
  overrides: Partial<ForwardGrantConfig> = {}
): ForwardGrantConfig {
  return {
    canGrant: true,
    enabled: true,
    role: "reader",
    onEnabledChange: vi.fn(),
    onRoleChange: vi.fn(),
    bots: {
      ready: true,
      peopleCount: 21,
      botCount: 178,
      groups: manyGroups(21),
      toggleBot: vi.fn(),
    },
    ...overrides,
  };
}

describe("GrantArea Bot list is collapsed by default (forward button overflow fix)", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  function render(grant: ForwardGrantConfig) {
    act(() => {
      ReactDOM.render(<GrantArea grant={grant} />, container);
    });
  }

  it("keeps the summary visible but renders no per-person rows until expanded", () => {
    render(config());
    expect(
      container.querySelector(".wk-fm-grant-bots-summary")?.textContent
    ).toContain("base.forwardModal.grant.botSummary");
    // The tall per-person list is what used to push the Footer out of the fixed-height modal.
    expect(container.querySelector(".wk-fm-grant-bot-list")).toBeNull();
    expect(container.querySelectorAll(".wk-fm-grant-bot-group").length).toBe(0);
    const toggle = container.querySelector(".wk-fm-grant-bots-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands to a bounded scroll list on demand and collapses again", () => {
    render(config());
    const toggle = container.querySelector(
      ".wk-fm-grant-bots-toggle"
    ) as HTMLButtonElement;
    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".wk-fm-grant-bot-list")).not.toBeNull();
    expect(container.querySelectorAll(".wk-fm-grant-bot-group").length).toBe(
      21
    );
    expect(
      (
        container.querySelector(".wk-fm-grant-bots-toggle") as HTMLButtonElement
      ).getAttribute("aria-expanded")
    ).toBe("true");

    act(() => {
      (
        container.querySelector(".wk-fm-grant-bots-toggle") as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".wk-fm-grant-bot-list")).toBeNull();
  });

  it("still lets an individual Bot be unchecked after expanding both levels", () => {
    const toggleBot = vi.fn();
    const grant = config();
    grant.bots!.toggleBot = toggleBot;
    render(grant);
    act(() => {
      (
        container.querySelector(".wk-fm-grant-bots-toggle") as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      (
        container.querySelector(".wk-fm-grant-bot-expand") as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const box = container.querySelector(
      ".wk-fm-grant-bot [role=checkbox]"
    ) as HTMLElement;
    expect(box).not.toBeNull();
    act(() => {
      box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggleBot).toHaveBeenCalledWith("b_0");
  });

  it("renders no Bot block when there are no Bots (zero-Bot compatible)", () => {
    render(
      config({
        bots: {
          ready: true,
          peopleCount: 3,
          botCount: 0,
          groups: [],
          toggleBot: vi.fn(),
        },
      })
    );
    expect(container.querySelector(".wk-fm-grant-bots")).toBeNull();
    expect(container.querySelector(".wk-fm-grant-bots-toggle")).toBeNull();
  });
});
