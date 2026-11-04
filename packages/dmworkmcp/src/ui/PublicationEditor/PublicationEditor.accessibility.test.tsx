// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getByRole } from "@testing-library/dom";

// Load the actual Select without initializing unrelated Semi canvas animations.
vi.mock("@douyinfe/semi-ui", async () => ({
  Select: (await import("@douyinfe/semi-ui/lib/es/select")).default,
}));

vi.mock("@octo/base", () => ({
  useI18n: () => {},
  t: (key: string) => key,
  WKButton: ({ children, variant, ...props }: any) => <button {...props}>{children}</button>,
  WKInput: ({ onChange, ...props }: any) => <input {...props} onChange={e => onChange(e.target.value)} />,
}));

import { PublicationEditorFields, type PublicationEditorFieldsProps } from "./index";

const host = document.createElement("div");
document.body.appendChild(host);
afterEach(() => { act(() => { ReactDOM.unmountComponentAtNode(host); }); });

describe("dependency selector accessible names with real Semi Select", () => {
  it.each(["en", "zh"])("labels each selector independently in %s", locale => {
    const names = locale === "zh" ? ["需求分析", "设计评审"] : ["Requirements", "Design review"];
    const props: PublicationEditorFieldsProps = {
      draft: { plugin: { plugin_id: "expert", listing_state: "published", created_by_type: "human", manifest_json: {}, plugin_json: {} }, relations: [] } as any,
      fields: { name: "", description: "", instruction: "", version: "1.0.0", changelog: "", versions: {} },
      deps: names.map((name, i) => ({ id: String(i), name, type: "skill", current: "v1", versions: [{ id: "v1", label: "1.0.0" }] })) as any,
      alerts: [{ plugin_id: "0" }] as any,
      busy: false, blocked: false, error: "", canSave: true,
      versionError: null, publishError: null, initialVisibility: "private",
      onFieldChange: vi.fn(), onRetry: vi.fn(), onBotUpdate: vi.fn(),
      onShowUpdates: vi.fn(), onInitialVisibilityChange: vi.fn(),
    };
    act(() => { ReactDOM.render(<PublicationEditorFields {...props} />, host); });
    for (const name of names) {
      expect(getByRole(host, "combobox", { name })).toBeTruthy();
    }
  });
});
