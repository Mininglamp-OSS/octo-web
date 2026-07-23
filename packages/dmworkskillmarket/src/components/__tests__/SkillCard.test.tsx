import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SkillCard, { getDescriptionTooltipStyle } from "../SkillCard";
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
  viewCount: 12,
  downloadCount: 0,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

describe("SkillCard", () => {
  it("renders the Stage 2 card contract", () => {
    render(<SkillCard skill={skill} categories={categories} onOpen={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ci-helper 我" })).toBeInTheDocument();
    expect(screen.getByText("我")).toBeInTheDocument();
    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText("调试")).toBeInTheDocument();
    expect(screen.getByText("日志")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.queryByText("开发工具")).not.toBeInTheDocument();
    expect(screen.getByText("ci-helper")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByLabelText("浏览次数：12")).toHaveTextContent("12");
    expect(screen.getByLabelText("下载次数：0")).toHaveTextContent("0");
  });

  it("shows publisher metadata for public skills", () => {
    render(
      <SkillCard
        skill={{ ...skill, visibility: "public" }}
        categories={categories}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "ci-helper 我" })).toBeInTheDocument();
    expect(screen.getByText("我")).toBeInTheDocument();
  });

  it("shows creator and owner when they are different", () => {
    render(
      <SkillCard
        skill={{
          ...skill,
          ownerId: "developer",
          ownerName: "Developer",
          creatorId: "bot-1",
          creatorName: "CI Bot",
        }}
        categories={categories}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("CI Bot")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ci-helper CI Bot · Developer" })).toBeInTheDocument();
  });

  it("uses a bot icon instead of @ for bot creators", () => {
    render(
      <SkillCard
        skill={{
          ...skill,
          ownerId: "developer",
          ownerName: "Developer",
          creatorId: "publisher_bot",
          creatorName: "Publisher Bot",
        }}
        categories={categories}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("Publisher Bot")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.queryByText("@Publisher Bot · @Developer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ci-helper Publisher Bot · Developer" })).toBeInTheDocument();
  });

  it("shows the bot name when catalog responses omit ownerId", () => {
    render(
      <SkillCard
        skill={{
          ...skill,
          ownerId: "",
          ownerName: "Developer",
          creatorId: "bot-1",
          creatorName: "lm-hermes",
        }}
        categories={categories}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("lm-hermes")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
  });

  it("treats equal stable IDs as one publisher even when names differ", () => {
    render(
      <SkillCard
        skill={{
          ...skill,
          ownerId: "developer",
          ownerName: "Developer",
          creatorId: "developer",
          creatorName: "Developer Renamed",
        }}
        categories={categories}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "ci-helper Developer Renamed" })).toBeInTheDocument();
    expect(screen.queryByText("Developer")).not.toBeInTheDocument();
  });

  it("keeps creator attribution when owner metadata is empty", () => {
    render(
      <SkillCard
        skill={{
          ...skill,
          ownerId: "",
          ownerName: "",
          creatorId: "publisher",
          creatorName: "Publisher",
        }}
        categories={categories}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("Publisher")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ci-helper Publisher" })).toBeInTheDocument();
  });

  it("supports keyboard open and exposed owner actions without opening the card", () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onInstall = vi.fn();

    render(
      <SkillCard
        skill={skill}
        categories={categories}
        onOpen={onOpen}
        onEdit={onEdit}
        onDelete={onDelete}
        onInstall={onInstall}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "ci-helper 我" }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(skill);

    expect(screen.queryByRole("button", { name: "安装" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑 ci-helper" }));
    expect(onEdit).toHaveBeenCalledWith(skill);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "删除 ci-helper" }));
    expect(onDelete).toHaveBeenCalledWith(skill);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("button", { name: "编辑 ci-helper" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "删除 ci-helper" }), { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("shows the full description tooltip only when the description is truncated", async () => {
    render(<SkillCard skill={skill} categories={categories} onOpen={vi.fn()} />);

    const description = screen.getByText(skill.description);
    Object.defineProperty(description, "scrollHeight", { configurable: true, value: 80 });
    Object.defineProperty(description, "clientHeight", { configurable: true, value: 42 });
    Object.defineProperty(description, "scrollWidth", { configurable: true, value: 300 });
    Object.defineProperty(description, "clientWidth", { configurable: true, value: 300 });

    fireEvent.mouseEnter(description);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(skill.description);

    fireEvent.mouseLeave(description);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hides the description tooltip before using owner actions", async () => {
    render(
      <SkillCard
        skill={skill}
        categories={categories}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    const description = screen.getByText(skill.description);
    Object.defineProperty(description, "scrollHeight", { configurable: true, value: 80 });
    Object.defineProperty(description, "clientHeight", { configurable: true, value: 42 });

    fireEvent.mouseEnter(description);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(skill.description);

    fireEvent.click(screen.getByRole("button", { name: "编辑 ci-helper" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("positions the tooltip above the description near the viewport bottom", () => {
    const style = getDescriptionTooltipStyle(
      { left: 120, top: 720, bottom: 762, width: 300, height: 42 },
      { left: 0, top: 0, bottom: 120, width: 300, height: 120 },
      { pageLeft: 80, contentTop: 164, viewportWidth: 900, viewportHeight: 800 },
    );

    expect(style.top).toBe(592);
    expect(style.maxHeight).toBe(548);
  });

  it("clamps very tall tooltips using constrained height", () => {
    const style = getDescriptionTooltipStyle(
      { left: 120, top: 220, bottom: 262, width: 300, height: 42 },
      { left: 0, top: 0, bottom: 1000, width: 300, height: 1000 },
      { pageLeft: 80, contentTop: 164, viewportWidth: 900, viewportHeight: 800 },
    );

    expect(style.top).toBe(270);
    expect(style.maxHeight).toBe(518);
  });
});
