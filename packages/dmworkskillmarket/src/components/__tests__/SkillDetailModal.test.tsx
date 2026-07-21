import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkillDetailModal from "../SkillDetailModal";
import * as api from "../../api/skillApi";
import type { Category, Skill } from "../../types/skill";

const categories: Category[] = [
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 1, skillCount: 1 },
];

const versionsButton = /版本历史|skillMarket\.detail\.tabVersions/;
const latestText = /最新|skillMarket\.detail\.latest/;
const noVersionsText = /暂无历史版本|skillMarket\.detail\.noVersions/;
const editTitle = /编辑|skillMarket\.common\.edit/;

const skill: Skill = {
  id: "meeting-note-cleaner",
  name: "meeting-note-cleaner",
  displayName: "test",
  iconUrl: "",
  description: "将会议纪要整理为决策、待办、风险和引用资料。",
  categoryId: "office",
  tags: ["纪要", "协作"],
  ownerId: "test-uid",
  ownerName: "我",
  spaceId: "space-demo",
  visibility: "space",
  version: "1.1.3",
  readmeContent: "# meeting-note-cleaner\n\n- 输出待办",
  fileName: "meeting-note-cleaner.zip",
  fileUrl: "mock://skills/meeting-note-cleaner.zip",
  fileSize: 4096,
  viewCount: 12,
  downloadCount: 3,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

vi.mock("../../api/skillApi");

describe("SkillDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSkill).mockResolvedValue(skill);
    vi.mocked(api.trackSkillView).mockResolvedValue(undefined);
    vi.mocked(api.getSkillMd).mockResolvedValue("# meeting-note-cleaner\n\n- 输出待办");
    vi.mocked(api.listVersions).mockResolvedValue([]);
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("does not render install or package download action panels", async () => {
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    expect(await screen.findByText("test")).toBeInTheDocument();
    expect(screen.queryByText(/Agent 安装|skillMarket\.detail\.installTitle/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /复制安装 Prompt|skillMarket\.detail\.copyPrompt/ })).not.toBeInTheDocument();
    expect(screen.queryByText("meeting-note-cleaner.zip")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下载 Skill 包|skillMarket\.detail\.downloadBtn/ })).not.toBeInTheDocument();
  });

  it("does not show visibility metadata", async () => {
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    expect(await screen.findByText("test")).toBeInTheDocument();
    expect(screen.queryByText(/空间可见|公开|私有|skillMarket\.detail\.visibility/)).not.toBeInTheDocument();
  });

  it("shows card metadata without file size", async () => {
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    expect(await screen.findByText("test")).toBeInTheDocument();
    expect(screen.getByTitle("meeting-note-cleaner")).toBeInTheDocument();
    expect(screen.getByTitle("办公协作")).toBeInTheDocument();
    expect(screen.getByTitle("@我")).toBeInTheDocument();
    expect(screen.getByTitle("v1.1.3")).toBeInTheDocument();
    expect(screen.getByTitle("浏览次数：12")).toHaveTextContent("12");
    expect(screen.getByTitle("下载次数：3")).toHaveTextContent("3");
    expect(screen.queryByText("meeting-note-cleaner.zip")).not.toBeInTheDocument();
    expect(screen.queryByText("4 KB")).not.toBeInTheDocument();
  });

  it("hides owner metadata for public skills", async () => {
    vi.mocked(api.getSkill).mockResolvedValue({ ...skill, visibility: "public" });

    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    expect(await screen.findByText("test")).toBeInTheDocument();
    expect(screen.getByTitle("meeting-note-cleaner")).toBeInTheDocument();
    expect(screen.queryByTitle("@我")).not.toBeInTheDocument();
  });

  it("tracks a view when the detail modal opens", async () => {
    render(<SkillDetailModal skillId={skill.id} categories={categories} refreshKey={1} onClose={vi.fn()} />);

    await screen.findByText("test");
    expect(api.trackSkillView).toHaveBeenCalledWith(skill.id);
    expect(api.trackSkillView).toHaveBeenCalledTimes(1);
  });

  it("keeps rendering detail content when view tracking fails", async () => {
    vi.mocked(api.trackSkillView).mockRejectedValue(new Error("metrics unavailable"));
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    expect(await screen.findByText("test")).toBeInTheDocument();
    expect(await screen.findByText(/输出待办/)).toBeInTheDocument();
  });

  it("shows version history tab with current version", async () => {
    vi.mocked(api.listVersions).mockResolvedValue([
      { id: "v2", skillId: skill.id, version: "1.1.3", changelog: "修复解析问题", storage: { type: "s3", object_key: "skills/abc/v1.1.3/f.zip" }, changedBy: "me", createdAt: "2026-07-10T00:00:00Z" },
      { id: "v1", skillId: skill.id, version: "1.0.0", changelog: "初始发布", storage: { type: "s3", object_key: "skills/abc/v1.0.0/f.zip" }, changedBy: "me", createdAt: "2026-05-20T00:00:00Z" },
    ]);
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    await screen.findByText("test");
    fireEvent.click(screen.getByRole("button", { name: versionsButton }));

    await waitFor(() => expect(screen.getByText(latestText)).toBeInTheDocument());
    expect(screen.getAllByText("v1.1.3")).toHaveLength(2);
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("初始发布")).toBeInTheDocument();
  });

  it("shows edit action for owner", async () => {
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} onEdit={vi.fn()} />);

    await screen.findByText("test");

    await waitFor(() => expect(screen.getByTitle(editTitle)).toBeInTheDocument());
  });

  it("hides owner actions for non-owner", async () => {
    const otherSkill = { ...skill, ownerId: "someone-else" };
    vi.mocked(api.getSkill).mockResolvedValue(otherSkill);
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} onEdit={vi.fn()} />);

    await screen.findByText("test");
    fireEvent.click(screen.getByRole("button", { name: versionsButton }));

    await waitFor(() => expect(screen.getByText(noVersionsText)).toBeInTheDocument());
    expect(screen.queryByTitle(editTitle)).not.toBeInTheDocument();
  });

  it("renders SKILL.md content from the dedicated endpoint", async () => {
    vi.mocked(api.getSkillMd).mockResolvedValue("# Skill MD Content\n\nFrom endpoint.");
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Skill MD Content")).toBeInTheDocument());
    expect(screen.getByText("From endpoint.")).toBeInTheDocument();
  });

  it("renders SKILL.md frontmatter as a metadata table", async () => {
    vi.mocked(api.getSkillMd).mockResolvedValue([
      "---",
      "name: skill-creator",
      "description: 创建新技能、修改和改进现有技能，并衡量技能表现。",
      "tags:",
      "  - Skill",
      "  - Creator",
      "---",
      "# 技能创建器",
      "",
      "一个用于创建新技能并对其进行迭代改进的技能。",
    ].join("\n"));
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("技能创建器")).toBeInTheDocument());
    expect(screen.getByRole("row", { name: /name skill-creator/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /description 创建新技能/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /tags Skill, Creator/ })).toBeInTheDocument();
    expect(screen.queryByText("---")).not.toBeInTheDocument();
  });

  it("falls back to readmeContent when skill-md returns 404", async () => {
    const error = new Error("SKILL.md not found");
    Object.assign(error, { status: 404 });
    vi.mocked(api.getSkillMd).mockRejectedValue(error);
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    // Should fall back to readmeContent from the skill object (contains "输出待办")
    await waitFor(() => expect(screen.getByText(/输出待办/)).toBeInTheDocument());
    // Should NOT show error/retry state
    expect(screen.queryByText("skillMarket.common.loadFailed")).not.toBeInTheDocument();
  });

  it("shows retry button on skill-md network error", async () => {
    const error = new Error("Network error");
    Object.assign(error, { status: 500 });
    vi.mocked(api.getSkillMd).mockRejectedValue(error);
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("加载失败")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });
});
