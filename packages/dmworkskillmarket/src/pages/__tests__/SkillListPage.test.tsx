import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SkillListPage from "../SkillListPage";
import * as api from "../../api/skillApi";
import type { Category, Skill } from "../../types/skill";

const categories: Category[] = [
  { id: "all", name: "全部", iconKey: "LayoutGrid", sortOrder: 99, skillCount: 1 },
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 1, skillCount: 1 },
];

const skill: Skill = {
  id: "meeting-note-cleaner",
  name: "meeting-note-cleaner",
  displayName: "会议纪要整理",
  iconUrl: "",
  description: "将会议纪要整理为决策、待办、风险和引用资料。",
  categoryId: "office",
  tags: ["纪要", "协作"],
  ownerId: "me",
  ownerName: "我",
  spaceId: "space-demo",
  visibility: "space",
  version: "1.1.3",
  readmeContent: "# meeting-note-cleaner\n\n- 输出待办",
  fileName: "meeting-note-cleaner.zip",
  fileUrl: "mock://skills/meeting-note-cleaner.zip",
  fileSize: 4096,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

vi.mock("../../api/skillApi");

async function switchToMineTab() {
  fireEvent.click(screen.getByRole("button", { name: "我的" }));
}

describe("SkillListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCategories).mockResolvedValue(categories);
    vi.mocked(api.getSkills).mockResolvedValue({ items: [skill], nextCursor: null });
    vi.mocked(api.getMySkills).mockResolvedValue({ items: [skill], nextCursor: null });
    vi.mocked(api.getSkill).mockResolvedValue(skill);
    vi.mocked(api.updateSkill).mockResolvedValue(skill);
    vi.mocked(api.deleteSkill).mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides category chips on the mine tab and shows owner actions", async () => {
    render(<SkillListPage />);
    await switchToMineTab();

    expect(screen.queryByLabelText("Skill 分类")).not.toBeInTheDocument();
    expect(await screen.findByText("meeting-note-cleaner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 meeting-note-cleaner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 meeting-note-cleaner" })).toBeInTheDocument();
  });

  it("debounces search by 300ms before reloading the list", async () => {
    vi.useFakeTimers();
    render(<SkillListPage />);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    vi.mocked(api.getSkills).mockClear();
    fireEvent.change(screen.getByPlaceholderText("搜索"), { target: { value: "ci" } });
    expect(api.getSkills).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(api.getSkills).toHaveBeenCalledWith(
      { q: "ci", categoryId: "all", cursor: undefined, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("confirms deletion and removes the skill through the API", async () => {
    render(<SkillListPage />);
    await switchToMineTab();

    fireEvent.click(await screen.findByRole("button", { name: "删除 meeting-note-cleaner" }));
    expect(screen.getByText("确定删除「meeting-note-cleaner」？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(api.deleteSkill).toHaveBeenCalledWith("meeting-note-cleaner"));
  });

  it("closes the detail modal when deleting a skill from within it", async () => {
    render(<SkillListPage />);
    await switchToMineTab();

    fireEvent.click(await screen.findByRole("button", { name: "meeting-note-cleaner @我" }));
    expect(await screen.findByText(skill.description)).toBeInTheDocument();
    expect(await screen.findByText(skill.fileName)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "删除 meeting-note-cleaner" })[1]);
    expect(screen.getByText("确定删除「meeting-note-cleaner」？")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(api.deleteSkill).toHaveBeenCalledWith("meeting-note-cleaner"));

    await waitFor(() => expect(screen.queryByText(skill.fileName)).not.toBeInTheDocument());
  });

  it("offers a clear-filter action when search returns no results", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({ items: [], nextCursor: null });
    render(<SkillListPage />);

    await waitFor(() => expect(screen.getByText("没有找到匹配的 Skill")).toBeInTheDocument());
    expect(screen.getByText("换个关键词或分类后再试，也可以清空筛选条件")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));

    expect(screen.getByPlaceholderText("搜索")).toHaveValue("");
    expect(api.getSkills).toHaveBeenCalled();
  });

  it("refreshes an open detail modal after saving from detail edit", async () => {
    const updatedSkill: Skill = {
      ...skill,
      displayName: "更新后的展示名",
      description: "更新后的详情说明",
      updatedAt: "2026-07-14T08:00:00.000Z",
    };
    vi.mocked(api.updateSkill).mockResolvedValue(updatedSkill);
    vi.mocked(api.getSkill)
      .mockResolvedValueOnce(skill)
      .mockResolvedValueOnce(updatedSkill);

    render(<SkillListPage />);
    await switchToMineTab();

    fireEvent.click(await screen.findByRole("button", { name: "meeting-note-cleaner @我" }));
    expect(await screen.findByText(skill.description)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "编辑 meeting-note-cleaner" })[1]);
    fireEvent.change(screen.getByPlaceholderText("请输入展示名称，最多20个字符"), { target: { value: updatedSkill.displayName } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(api.updateSkill).toHaveBeenCalledWith("meeting-note-cleaner", expect.objectContaining({
      displayName: updatedSkill.displayName,
    })));
    expect(await screen.findByText(updatedSkill.description)).toBeInTheDocument();
    expect(api.getSkill).toHaveBeenCalledTimes(2);
  });

  it("shows a search-specific empty state with a clear-search action", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({ items: [], nextCursor: null });

    render(<SkillListPage />);

    fireEvent.change(screen.getByPlaceholderText("搜索"), { target: { value: "missing" } });

    expect(await screen.findByText("没有找到匹配的 Skill")).toBeInTheDocument();
    expect(screen.getByText("清空搜索")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(screen.getByPlaceholderText("搜索")).toHaveValue("");
  });

  it("shows a category-specific empty state when the selected category has no skills", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({ items: [], nextCursor: null });

    render(<SkillListPage />);

    fireEvent.click(await screen.findByRole("button", { name: /办公协作/ }));

    expect(await screen.findByText("该分类暂无 Skill")).toBeInTheDocument();
    expect(screen.getByText("可以切换到其他分类，或新建一个 Skill。")).toBeInTheDocument();
  });

  it("shows detail download action", async () => {
    vi.mocked(api.downloadSkill).mockReturnValue(undefined);

    render(<SkillListPage />);

    fireEvent.click(await screen.findByRole("button", { name: "meeting-note-cleaner @我" }));
    fireEvent.click(await screen.findByRole("button", { name: "下载 Skill 包" }));
    expect(api.downloadSkill).toHaveBeenCalledWith(skill.id);
  });
});
