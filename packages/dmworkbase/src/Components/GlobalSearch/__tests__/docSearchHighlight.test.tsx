import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// i18n: identity translator so the panel renders without a provider.
vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "en-US" }),
}));

import type {
  DocSearchItem,
  GlobalSearchDataSource,
} from "../../../Service/SearchTypes";
import DocSearchPanel from "../DocSearchPanel";

// The backend `highlight` fragment carries <em></em> emphasis markers around
// matched terms. renderHighlight (in DocSearchPanel) is the XSS boundary: it
// must render ONLY <em> from an allowlist and treat everything else as plain,
// React-escaped text — never dangerouslySetInnerHTML. These tests pin that
// invariant so a future "simplification" toward innerHTML can't silently
// re-open XSS.
function makeDataSource(highlight: string): GlobalSearchDataSource {
  const item: DocSearchItem = {
    docId: "d1",
    title: "Result",
    docType: "doc",
    updatedAt: 0,
    highlight,
  };
  return {
    searchDocs: vi.fn(async () => ({ total: 1, items: [item] })),
  } as unknown as GlobalSearchDataSource;
}

function renderPanel(highlight: string) {
  return render(
    <DocSearchPanel keyword="term" dataSource={makeDataSource(highlight)} />
  );
}

describe("DocSearchPanel renderHighlight — <em>-only XSS allowlist", () => {
  it("wraps only the <em> span and escapes surrounding text", async () => {
    renderPanel("before <em>hit</em> after");
    const em = await screen.findByText("hit");
    expect(em.tagName).toBe("EM");
    // The surrounding text is present as plain text (React-escaped).
    expect(await screen.findByText(/before/)).toBeInTheDocument();
  });

  it("does NOT execute injected markup — a script tag renders as inert text", async () => {
    const { container } = renderPanel(
      "<em>ok</em> <script>alert(1)</script> <img src=x onerror=alert(1)>"
    );
    await screen.findByText("ok");
    // No live <script>/<img> element was created from the fragment.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The dangerous markup survives as escaped text content.
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("treats HTML nested inside <em> as text, not elements", async () => {
    const { container } = renderPanel("<em><b>bold</b></em>");
    // Wait for the async search result to render before inspecting the DOM.
    await screen.findByText("Result");
    // The <em> is created (allowlisted) but the inner <b> is NOT an element.
    expect(container.querySelector("em")).not.toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
  });

  it("renders a plain fragment with no <em> as text without throwing", async () => {
    const { container } = renderPanel("just plain text");
    expect(await screen.findByText(/just plain text/)).toBeInTheDocument();
    expect(container.querySelector("em")).toBeNull();
  });
});
