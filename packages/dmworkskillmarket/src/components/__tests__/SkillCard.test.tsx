import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SkillCard from "../SkillCard";
import type { Category, Skill } from "../../types/skill";

const categories: Category[] = [
  { id: "dev-tools", name: "开发工具", iconKey: "Terminal", sortOrder: 1, skillCount: 8 },
];

const skill: Skill = {
  id: "ci-helper",
  name: "ci-helper",
  displayName: "test",
  iconUrl: "",
  description: "分析 CI 失败日志并定位到可能负责的模块、命令和最近提交。",
  categoryId: "dev-tools",
  tags: ["CI", "调试", "日志", "发布"],
  ownerId: "me",
  ownerName: "我",
  spaceId: "space-demo",
  visibility: "space",
  version: "1.0.0",
  readmeContent: "# ci-helper",
  fileName: "ci-helper.zip",
  fileUrl: "mock://skills/ci-helper.zip",
  fileSize: 1024,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

describe("SkillCard", () => {
  it("renders the Stage 2 card contract", () => {
    render(<SkillCard skill={skill} categories={categories} onOpen={vi.fn()} />);

    expect(screen.getByText("ci-helper")).toBeInTheDocument();
    expect(screen.getByText("@我")).toBeInTheDocument();
    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText("调试")).toBeInTheDocument();
    expect(screen.getByText("日志")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.queryByText("开发工具")).not.toBeInTheDocument();
    expect(screen.queryByText("v1.0.0")).not.toBeInTheDocument();
  });

  it("supports keyboard open and icon actions without opening the card", () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <SkillCard
        skill={skill}
        categories={categories}
        onOpen={onOpen}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "ci-helper @我" }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(skill);

    fireEvent.click(screen.getByRole("button", { name: "编辑 ci-helper" }));
    expect(onEdit).toHaveBeenCalledWith(skill);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "删除 ci-helper" }));
    expect(onDelete).toHaveBeenCalledWith(skill);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("button", { name: "编辑 ci-helper" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "删除 ci-helper" }), { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
