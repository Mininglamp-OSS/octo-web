// @vitest-environment jsdom
//
// S3 registry + HostConfig：动作层防御纵深（移除 Execute/ShowCard/ToggleVisibility），
// HostConfig 颜色经可注入解析器映射自 --wk-* token。

import { describe, expect, it, vi } from "vitest";
import { createOctoSerializationContext } from "../sdk/octoSerialization";
import { buildOctoHostConfig } from "../sdk/octoHostConfig";

describe("createOctoSerializationContext — 动作层防御纵深", () => {
  it("只保留 Action.OpenUrl + Action.Submit，移除有副作用的动作", () => {
    const ctx = createOctoSerializationContext();
    const reg = ctx.actionRegistry;
    expect(reg.findByName("Action.OpenUrl")).toBeDefined();
    expect(reg.findByName("Action.Submit")).toBeDefined();
    expect(reg.findByName("Action.Execute")).toBeUndefined();
    expect(reg.findByName("Action.ShowCard")).toBeUndefined();
    expect(reg.findByName("Action.ToggleVisibility")).toBeUndefined();
  });
});

describe("createOctoSerializationContext — 元素层防御纵深", () => {
  it("保留 octo 白名单元素，移除非白名单元素", () => {
    const ctx = createOctoSerializationContext();
    const reg = ctx.elementRegistry;
    // octo 允许的元素仍注册（Column 由 ColumnSet 内部解析，非独立注册项，不单列）。
    for (const t of [
      "TextBlock",
      "Image",
      "Container",
      "ColumnSet",
      "FactSet",
      "Input.Text",
      "Input.Toggle",
      "Input.ChoiceSet",
    ]) {
      expect(reg.findByName(t)).toBeDefined();
    }
    // 非白名单元素被移除。
    for (const t of [
      "Table",
      "Carousel",
      "Media",
      "RichTextBlock",
      "ImageSet",
      "ActionSet",
      "Input.Number",
      "Input.Date",
      "Input.Time",
    ]) {
      expect(reg.findByName(t)).toBeUndefined();
    }
  });
});

describe("buildOctoHostConfig — --wk-* 颜色映射", () => {
  it("用注入解析器解析语义色，产出 HostConfig 实例", () => {
    const resolve = vi.fn((expr: string) => {
      const map: Record<string, string> = {
        "var(--wk-text-primary)": "rgb(10, 10, 10)",
        "var(--wk-text-secondary)": "rgb(120, 120, 120)",
        "var(--wk-text-accent)": "rgb(30, 100, 255)",
        "var(--wk-bg-surface)": "rgb(255, 255, 255)",
      };
      return map[expr] ?? expr;
    });
    const hc = buildOctoHostConfig(resolve);
    // 四个语义色都被解析。
    expect(resolve).toHaveBeenCalledWith("var(--wk-text-primary)");
    expect(resolve).toHaveBeenCalledWith("var(--wk-text-secondary)");
    expect(resolve).toHaveBeenCalledWith("var(--wk-text-accent)");
    expect(resolve).toHaveBeenCalledWith("var(--wk-bg-surface)");
    // 具体色值落进 containerStyles.default。
    const style = hc.containerStyles.getStyleByName("default");
    expect(style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(style.foregroundColors.default.default).toBe("rgb(10, 10, 10)");
    expect(style.foregroundColors.default.subtle).toBe("rgb(120, 120, 120)");
    expect(style.foregroundColors.accent.default).toBe("rgb(30, 100, 255)");
    expect(hc.supportsInteractivity).toBe(true);
  });
});
