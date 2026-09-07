// @vitest-environment jsdom
import React from "react";
import { fireEvent, waitFor } from "@testing-library/dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let Tooltip: typeof import("./index").Tooltip;
let container: HTMLDivElement;
let root: Root;

const originalMatches = Element.prototype.matches;

beforeAll(async () => {
  const canvasContext = new Proxy({}, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);
      return () => undefined;
    },
  }) as CanvasRenderingContext2D;

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext);
  ({ Tooltip } = await import("./index"));
}, 30_000);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(Element.prototype, "matches").mockImplementation(function matches(this: Element, selector) {
    if (selector === ":hover") return true;
    return originalMatches.call(this, selector);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

async function expectNoTooltipAfterHover(label: string) {
  fireEvent.mouseEnter(document.querySelector(`[aria-label="${label}"]`)!);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(document.querySelector(".semi-tooltip-content")).toBeNull();
}

describe("Tooltip with real Semi", () => {
  it("does not show disabled or blank tooltips on hover", async () => {
    render(
      <>
        <Tooltip content="Disabled content" isDisabled>
          <button type="button" aria-label="disabled-trigger">Disabled</button>
        </Tooltip>
        <Tooltip content="   ">
          <button type="button" aria-label="blank-trigger">Blank</button>
        </Tooltip>
      </>
    );

    await expectNoTooltipAfterHover("disabled-trigger");
    await expectNoTooltipAfterHover("blank-trigger");
  });

  it("still shows enabled tooltip content on hover", async () => {
    render(
      <Tooltip content="Enabled content">
        <button type="button" aria-label="enabled-trigger">Enabled</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(document.querySelector('[aria-label="enabled-trigger"]')!);

    await waitFor(() => {
      expect(document.querySelector(".semi-tooltip-content")?.textContent).toBe("Enabled content");
    });
  });
});
