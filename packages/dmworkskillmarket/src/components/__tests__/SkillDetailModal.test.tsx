import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkillDetailModal from "../SkillDetailModal";
import * as api from "../../api/skillApi";
import type { Category, Skill } from "../../types/skill";

const categories: Category[] = [
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 1, skillCount: 1 },
];

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
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

vi.mock("../../api/skillApi");

describe("SkillDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSkill).mockResolvedValue(skill);
    vi.mocked(api.listVersions).mockResolvedValue([]);
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("copies install prompt and opens download", async () => {
    vi.mocked(api.downloadSkill).mockReturnValue(undefined);
    const onFeedback = vi.fn();
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} onFeedback={onFeedback} />);

    expect(await screen.findByText("meeting-note-cleaner.zip")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制安装 Prompt" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(onFeedback).toHaveBeenCalledWith("安装 Prompt 已复制");

    fireEvent.click(screen.getByRole("button", { name: "下载 Skill 包" }));
    expect(api.downloadSkill).toHaveBeenCalledWith(skill.id);
    expect(onFeedback).toHaveBeenCalledWith("下载已打开");
  });

  it("shows version history tab with current version", async () => {
    vi.mocked(api.listVersions).mockResolvedValue([
      { id: "v2", skillId: skill.id, version: "1.1.3", changelog: "修复解析问题", storage: { type: "s3", object_key: "skills/abc/v1.1.3/f.zip" }, changedBy: "me", createdAt: "2026-07-10T00:00:00Z" },
      { id: "v1", skillId: skill.id, version: "1.0.0", changelog: "初始发布", storage: { type: "s3", object_key: "skills/abc/v1.0.0/f.zip" }, changedBy: "me", createdAt: "2026-05-20T00:00:00Z" },
    ]);
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    await screen.findByText("meeting-note-cleaner.zip");
    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));

    await waitFor(() => expect(screen.getByText("最新")).toBeInTheDocument());
    expect(screen.getByText("v1.1.3")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("初始发布")).toBeInTheDocument();
  });

  it("shows upload button for owner", async () => {
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} onPublishVersion={vi.fn()} />);

    await screen.findByText("meeting-note-cleaner.zip");
    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));

    await waitFor(() => expect(screen.getByTitle("上传新版本")).toBeInTheDocument());
  });

  it("hides upload button for non-owner", async () => {
    const otherSkill = { ...skill, ownerId: "someone-else" };
    vi.mocked(api.getSkill).mockResolvedValue(otherSkill);
    render(<SkillDetailModal skillId={skill.id} categories={categories} onClose={vi.fn()} />);

    await screen.findByText("meeting-note-cleaner.zip");
    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));

    await waitFor(() => expect(screen.getByText("暂无历史版本")).toBeInTheDocument());
    expect(screen.queryByTitle("上传新版本")).not.toBeInTheDocument();
  });
});
