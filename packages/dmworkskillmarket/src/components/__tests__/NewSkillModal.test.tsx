import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewSkillModal from "../NewSkillModal";
import * as api from "../../api/skillApi";
import type { Category } from "../../types/skill";

const categories: Category[] = [
  { id: "all", name: "全部", iconKey: "LayoutGrid", sortOrder: 99, skillCount: 1 },
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 1, skillCount: 1 },
  { id: "dev-tools", name: "开发工具", iconKey: "Code", sortOrder: 2, skillCount: 1 },
];

vi.mock("../../api/skillApi");

function zipFile(name = "skill-pack.zip", size = 1024 * 1024) {
  return new File(["x".repeat(Math.min(size, 1024))], name, { type: "application/zip" });
}

describe("NewSkillModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createSkill).mockResolvedValue({} as never);
    vi.mocked(api.initUpload).mockResolvedValue({
      uploadId: "upload-123",
      presignedUrl: "http://localhost/upload/123",
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      expiresIn: 3600,
    });
    vi.mocked(api.uploadFile).mockResolvedValue(undefined);
    vi.mocked(api.triggerParse).mockResolvedValue({ taskId: "task-123" });
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "skill-pack",
        description: "skill-pack 提供可复用的自动化工作流。",
        tags: ["自动化", "Skill"],
        version: "1.0.0",
        readmeContent: "# skill-pack",
        fileName: "skill-pack.zip",
        fileSize: 1024,
        fileSha256: "abc123",
      },
    });
  });

  it("validates zip files before upload starts", () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("选择 Skill zip 文件"), {
      target: { files: [new File(["readme"], "skill.txt", { type: "text/plain" })] },
    });

    expect(screen.getByText("文件格式不正确")).toBeInTheDocument();
    expect(screen.queryByText("上传进度")).not.toBeInTheDocument();
  });

  it("uploads, parses, prefills the form, and creates a skill", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<NewSkillModal visible categories={categories} onClose={onClose} onCreated={onCreated} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("选择 Skill zip 文件"), {
        target: { files: [zipFile()] },
      });
    });

    // Wait for the async upload/parse flow to complete
    await waitFor(() => {
      expect(screen.getByText("skill-pack")).toBeInTheDocument();
    });

    expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    expect(api.initUpload).toHaveBeenCalledWith("skill-pack.zip", expect.any(Number));
    expect(api.uploadFile).toHaveBeenCalled();
    expect(api.triggerParse).toHaveBeenCalledWith("upload-123");
    expect(api.pollParse).toHaveBeenCalledWith("task-123");

    fireEvent.change(screen.getByPlaceholderText("请输入展示名称，最多20个字符"), { target: { value: "快速Todo" } });
    fireEvent.change(screen.getByLabelText("分类"), { target: { value: "office" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({
        name: "skill-pack",
        displayName: "快速Todo",
        categoryId: "office",
        parseTaskId: "task-123",
      }));
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disables create until required fields are filled", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("选择 Skill zip 文件"), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "创建" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("请输入展示名称，最多20个字符"), { target: { value: "测试名" } });
    fireEvent.change(screen.getByLabelText("分类"), { target: { value: "office" } });

    expect(screen.getByRole("button", { name: "创建" })).not.toBeDisabled();
  });

  it("shows a leave confirmation while upload work is in progress", async () => {
    // Make initUpload hang (never resolves) to simulate in-progress upload
    vi.mocked(api.initUpload).mockReturnValue(new Promise(() => {}));

    const onClose = vi.fn();
    render(<NewSkillModal visible categories={categories} onClose={onClose} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("选择 Skill zip 文件"), {
        target: { files: [zipFile()] },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByText("确定离开？Skill 包正在上传/解析中，离开后当前进度将丢失，需要重新上传。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续上传" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "确认离开" }));
    expect(onClose).toHaveBeenCalled();
  });
});
