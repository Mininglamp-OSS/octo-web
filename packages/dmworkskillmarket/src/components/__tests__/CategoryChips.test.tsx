import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CategoryChips from "../CategoryChips";
import type { Category } from "../../types/skill";

const categories: Category[] = [
  { id: "all", name: "全部", iconKey: "LayoutGrid", sortOrder: 99, skillCount: 20 },
  { id: "dev", name: "开发工具", iconKey: "Terminal", sortOrder: 1, skillCount: 8 },
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 2, skillCount: 3 },
  { id: "empty", name: "空分类", iconKey: "Box", sortOrder: 3, skillCount: 0 },
  { id: "research", name: "洞察研究", iconKey: "Eye", sortOrder: 4, skillCount: 1 },
  { id: "quality", name: "代码质检", iconKey: "ShieldCheck", sortOrder: 5, skillCount: 2 },
];

describe("CategoryChips", () => {
  it("keeps all first and the selected overflow category visible", () => {
    render(<CategoryChips categories={categories} activeId="quality" onChange={vi.fn()} />);

    const list = screen.getByLabelText("Skill 分类");
    const buttons = within(list).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("全部");
    expect(within(list).getByRole("button", { name: /洞察研究/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /代码质检/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /更多/ })).toBeInTheDocument();
  });

  it("stores overflow categories in the more menu", () => {
    const onChange = vi.fn();
    render(<CategoryChips categories={categories} activeId="all" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /更多/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /代码质检/ }));

    expect(onChange).toHaveBeenCalledWith("quality");
  });

  it("offers all non-all categories from the mobile more menu", () => {
    render(<CategoryChips categories={categories} activeId="all" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /更多/ }));
    const menu = screen.getByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: /开发工具/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /办公协作/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /洞察研究/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /代码质检/ })).toBeInTheDocument();
  });

  it("still renders the mobile more menu when desktop has no overflow", () => {
    render(<CategoryChips categories={categories.slice(0, 4)} activeId="all" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /更多/ }));
    const menu = screen.getByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: /开发工具/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /办公协作/ })).toBeInTheDocument();
  });
});
