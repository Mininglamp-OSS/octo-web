import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewSkillModal from "../NewSkillModal";
import * as api from "../../api/skillApi";
import type { Category, Skill } from "../../types/skill";

const categories: Category[] = [
  { id: "all", name: "全部", iconKey: "LayoutGrid", sortOrder: 99, skillCount: 1 },
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 1, skillCount: 1 },
  { id: "dev-tools", name: "开发工具", iconKey: "Code", sortOrder: 2, skillCount: 1 },
];

vi.mock("../../api/skillApi");
vi.mock("react-avatar-editor", async () => {
  const React = await import("react");
  const AvatarEditor = React.forwardRef((_props: unknown, ref: React.ForwardedRef<{ getImageScaledToCanvas: () => HTMLCanvasElement }>) => {
    React.useImperativeHandle(ref, () => ({
      getImageScaledToCanvas: () => document.createElement("canvas"),
    }));
    return React.createElement("canvas", { "data-testid": "avatar-editor" });
  });
  AvatarEditor.displayName = "AvatarEditorMock";
  return { default: AvatarEditor };
});

const selectZipLabel = /选择技能包文件|skillMarket\.upload\.selectFileAriaLabel/;
const displayNamePlaceholder = /请输入展示名称，最多20个字符|skillMarket\.form\.displayNamePlaceholder/;
const categoryLabel = /分类|skillMarket\.form\.category/;
const tagPlaceholder = /输入或选择标签|skillMarket\.form\.tagPlaceholder/;
const createButton = /创建|skillMarket\.common\.create/;
const cancelButton = /取消|skillMarket\.common\.cancel/;
const invalidFormat = /文件格式不正确|skillMarket\.upload\.invalidFormat/;
const uploadProgress = /上传进度|skillMarket\.upload\.uploadProgress/;
const busyMessage = /确定离开？技能包正在上传\/解析中，离开后当前进度将丢失，需要重新上传。|skillMarket\.confirm\.busyMessage/;
const keepUploading = /继续上传|skillMarket\.confirm\.keepUploading/;
const leaveButton = /确认离开|skillMarket\.confirm\.leave/;
const tagLimit = /最多添加 10 个标签|skillMarket\.form\.tagLimit/;
const tagLengthLimit = /单个标签最多 10 个字符|skillMarket\.form\.tagLengthLimit/;
const tagInvalidChars = /标签仅支持文字、数字、空格和 - _ \. \/ # \+|skillMarket\.form\.tagInvalidChars/;
const tagDuplicate = /标签已存在|skillMarket\.form\.tagDuplicate/;

function zipFile(name = "skill-pack.zip", size = 1024 * 1024) {
  return new File(["x".repeat(Math.min(size, 1024))], name, { type: "application/zip" });
}

function skillFile(name = "skill-pack.skill", size = 1024 * 1024) {
  return new File(["x".repeat(Math.min(size, 1024))], name, { type: "application/zip" });
}

const submitReviewButton = /提交审核|skillMarket\.review\.submitAction/;
const selectNewZipLabel = /选择新的技能包文件|skillMarket\.upload\.selectNewFileAriaLabel/;
const packageRequiredHint = /发布新版本需要先上传新的技能包|skillMarket\.review\.packageRequired/;
const nameMismatch = /必须保持为|skillMarket\.upload\.nameMismatch/;
const upgradeNotice = /审核通过后才会替换在架内容|skillMarket\.review\.upgradeNotice/;
const firstListingNotice = /审核通过后组织内成员可见|skillMarket\.review\.firstListingNotice/;
const changelogPlaceholder = /简述本次提交的变更内容|skillMarket\.review\.changelogPlaceholder/;

function reviewSkillFixture(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-pack",
    name: "skill-pack",
    displayName: "技能包",
    description: "描述",
    categoryId: "office",
    tags: ["自动化"],
    ownerId: "dev-user",
    ownerName: "Dev",
    spaceId: "space-1",
    // Listed to the org — an upgrade submission.
    visibility: "space",
    version: "1.0.0",
    readmeContent: "# skill-pack",
    iconUrl: "",
    fileName: "skill-pack.zip",
    fileUrl: "",
    fileSize: 1024,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("NewSkillModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createSkill).mockResolvedValue({} as never);
    vi.mocked(api.getSkillTags).mockResolvedValue([
      { name: "ui-case", createdBy: "dev-user" },
      { name: "automation", createdBy: "dev-user" },
    ]);
    vi.mocked(api.initUpload).mockResolvedValue({
      uploadId: "upload-123",
      presignedUrl: "http://localhost/upload/123",
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      expiresIn: 3600,
    });
    vi.mocked(api.uploadFile).mockResolvedValue(undefined);
    vi.mocked(api.triggerParse).mockResolvedValue({ taskId: "task-123" });
    vi.mocked(api.initReupload).mockResolvedValue({
      uploadId: "upload-456",
      presignedUrl: "http://localhost/upload/456",
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      expiresIn: 3600,
    });
    vi.mocked(api.createReviewRequest).mockResolvedValue({} as never);
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

  it("validates Skill package files before upload starts", () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(selectZipLabel), {
      target: { files: [new File(["readme"], "skill.txt", { type: "text/plain" })] },
    });

    expect(screen.getByText(invalidFormat)).toBeInTheDocument();
    expect(screen.queryByText(uploadProgress)).not.toBeInTheDocument();
  });

  it("uploads, parses, prefills the form, and creates a skill", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<NewSkillModal visible categories={categories} onClose={onClose} onCreated={onCreated} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [skillFile()] },
      });
    });

    // Wait for the async upload/parse flow to complete
    await waitFor(() => {
      expect(screen.getByText("skill-pack.skill")).toBeInTheDocument();
    });

    expect(screen.getByText("skill-pack.skill")).toBeInTheDocument();
    expect(api.initUpload).toHaveBeenCalledWith("skill-pack.skill", expect.any(Number));
    expect(api.uploadFile).toHaveBeenCalled();
    expect(api.triggerParse).toHaveBeenCalledWith("upload-123");
    expect(api.pollParse).toHaveBeenCalledWith("task-123");

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "快速Todo" } });
    fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });
    fireEvent.click(screen.getByRole("button", { name: createButton }));

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

  it("opens the hidden icon file input and shows the crop dialog after selecting an image", async () => {
    const { container } = render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [skillFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.skill")).toBeInTheDocument();
    });

    const iconInput = container.querySelector<HTMLInputElement>(".skill-market-icon-upload__input");
    expect(iconInput).toBeTruthy();
    const clickSpy = vi.spyOn(iconInput!, "click").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: /上传图标|skillMarket\.form\.uploadIcon/ }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.change(iconInput!, {
      target: { files: [new File(["png"], "icon.png", { type: "image/png" })] },
    });

    expect(screen.getByRole("dialog", { name: /裁剪图标|skillMarket\.crop\.title/ })).toBeInTheDocument();
  });

  it("disables create until required fields are filled", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: createButton })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "测试名" } });
    fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });

    expect(screen.getByRole("button", { name: createButton })).not.toBeDisabled();
  });

  it("suggests current-space tags while typing and adds the selected tag", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    const tagInput = screen.getByPlaceholderText(tagPlaceholder);
    fireEvent.change(tagInput, { target: { value: "ui" } });

    await waitFor(() => {
      expect(api.getSkillTags).toHaveBeenCalledWith("ui", expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(screen.getByRole("option", { name: "ui-case" })).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole("option", { name: "ui-case" }));

    expect(
      screen.getAllByRole("button").some((button) => button.textContent?.trim() === "ui-case"),
    ).toBe(true);
  });

  it("trims suggested tags before checking duplicates", async () => {
    vi.mocked(api.getSkillTags).mockResolvedValue([{ name: " Skill ", createdBy: "dev-user" }]);
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });
    await waitFor(() => expect(screen.getByText("skill-pack.zip")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(tagPlaceholder), { target: { value: "ski" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Skill" }));

    expect(screen.getByText(tagDuplicate)).toBeInTheDocument();
    expect(screen.getAllByTitle("Skill")).toHaveLength(1);
  });

  it("shows a tag limit hint when ten tags are already selected", async () => {
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "skill-pack",
        description: "skill-pack 提供可复用的自动化工作流。",
        tags: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
        version: "1.0.0",
        readmeContent: "# skill-pack",
        fileName: "skill-pack.zip",
        fileSize: 1024,
        fileSha256: "abc123",
      },
    });
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(tagLimit)).toBeInTheDocument();
    });
  });

  it("blocks an 11-tag parse result and recovers after removing one tag", async () => {
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "skill-pack",
        description: "skill-pack 提供可复用的自动化工作流。",
        tags: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"],
        version: "1.0.0",
        readmeContent: "# skill-pack",
        fileName: "skill-pack.zip",
        fileSize: 1024,
        fileSha256: "abc123",
      },
    });
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });
    await waitFor(() => expect(screen.getByText(tagLimit)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "Skill Pack" } });
    fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });
    const create = screen.getByRole("button", { name: createButton });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(api.createSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "eleven" }));
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({
      tags: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
    })));
  });

  it("shows tag validation hints for invalid characters and length", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    const tagInput = screen.getByPlaceholderText(tagPlaceholder);
    fireEvent.change(tagInput, { target: { value: "bad<tag" } });
    expect(screen.getByText(tagInvalidChars)).toBeInTheDocument();

    fireEvent.change(tagInput, { target: { value: "abcdefghijklmnopqrstuvwxyz" } });
    expect(screen.getByText(tagLengthLimit)).toBeInTheDocument();
  });

  it("blocks create while a tag validation error is visible", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "快速Todo" } });
    fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });
    fireEvent.change(screen.getByPlaceholderText(tagPlaceholder), { target: { value: "bad<tag" } });

    expect(screen.getByText(tagInvalidChars)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: createButton })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: createButton }));
    expect(api.createSkill).not.toHaveBeenCalled();
  });

  it("shows a leave confirmation while upload work is in progress", async () => {
    // Make initUpload hang (never resolves) to simulate in-progress upload
    vi.mocked(api.initUpload).mockReturnValue(new Promise(() => {}));

    const onClose = vi.fn();
    render(<NewSkillModal visible categories={categories} onClose={onClose} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: cancelButton }));

    expect(screen.getByText(busyMessage)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: keepUploading }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: cancelButton }));
    fireEvent.click(screen.getByRole("button", { name: leaveButton }));
    expect(onClose).toHaveBeenCalled();
  });

  describe("review mode", () => {
    it("submits an upgrade with the newly uploaded package as its content", async () => {
      const onCreated = vi.fn();
      const onClose = vi.fn();
      render(
        <NewSkillModal
          visible
          categories={categories}
          onClose={onClose}
          onCreated={onCreated}
          reviewSkill={reviewSkillFixture()}
        />,
      );

      // The copy must not imply the change is live on submit.
      expect(screen.getByText(upgradeNotice)).toBeInTheDocument();

      // Nothing is submittable until the new package is uploaded — for a listed
      // plugin the row is the live content, so a version label alone would have
      // the reviewer approve something that already shipped.
      const submit = screen.getByRole("button", { name: submitReviewButton });
      expect(submit).toBeDisabled();

      await act(async () => {
        fireEvent.change(screen.getByLabelText(selectNewZipLabel), {
          target: { files: [zipFile()] },
        });
      });

      await waitFor(() => {
        expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
      });
      // A review-mode upload goes through the reupload init, bound to the skill.
      expect(api.initReupload).toHaveBeenCalledWith("skill-pack", "skill-pack.zip", expect.any(Number));
      expect(api.initUpload).not.toHaveBeenCalled();
      expect(api.triggerParse).toHaveBeenCalledWith("upload-456");

      fireEvent.change(screen.getByPlaceholderText(changelogPlaceholder), {
        target: { value: "修了解析" },
      });

      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => {
        expect(api.createReviewRequest).toHaveBeenCalledWith({
          pluginId: "skill-pack",
          // The package declares 1.0.0, which is what is already live — the
          // suggested bump is kept rather than re-declaring the live label.
          version: "1.0.1",
          changelog: "修了解析",
          parseTaskId: "task-123",
        });
      });
      // No plugin write: the live content must not change before approval.
      expect(api.createSkill).not.toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("adopts a version the new package actually bumped", async () => {
      vi.mocked(api.pollParse).mockResolvedValue({
        status: "success",
        result: {
          name: "skill-pack",
          description: "d",
          tags: [],
          version: "2.0.0",
          readmeContent: "# skill-pack",
          fileName: "skill-pack.zip",
          fileSize: 1024,
          fileSha256: "abc",
        },
      });
      render(
        <NewSkillModal
          visible
          categories={categories}
          onClose={vi.fn()}
          onCreated={vi.fn()}
          reviewSkill={reviewSkillFixture()}
        />,
      );

      await act(async () => {
        fireEvent.change(screen.getByLabelText(selectNewZipLabel), {
          target: { files: [zipFile()] },
        });
      });
      await waitFor(() => expect(screen.getByText("skill-pack.zip")).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText(changelogPlaceholder), {
        target: { value: "大改" },
      });
      const submit = screen.getByRole("button", { name: submitReviewButton });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() =>
        expect(api.createReviewRequest).toHaveBeenCalledWith(
          expect.objectContaining({ version: "2.0.0", parseTaskId: "task-123" }),
        ),
      );
    });

    it("blocks an upgrade whose package declares a different skill name", async () => {
      vi.mocked(api.pollParse).mockResolvedValue({
        status: "success",
        result: {
          name: "other-skill",
          description: "d",
          tags: [],
          version: "1.1.0",
          readmeContent: "# other",
          fileName: "skill-pack.zip",
          fileSize: 1024,
          fileSha256: "abc",
        },
      });
      render(
        <NewSkillModal
          visible
          categories={categories}
          onClose={vi.fn()}
          onCreated={vi.fn()}
          reviewSkill={reviewSkillFixture()}
        />,
      );

      await act(async () => {
        fireEvent.change(screen.getByLabelText(selectNewZipLabel), {
          target: { files: [zipFile()] },
        });
      });

      await waitFor(() => expect(screen.getByText(nameMismatch)).toBeInTheDocument());
      fireEvent.change(screen.getByPlaceholderText(changelogPlaceholder), {
        target: { value: "改了点东西" },
      });
      const submit = screen.getByRole("button", { name: submitReviewButton });
      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(api.createReviewRequest).not.toHaveBeenCalled();
    });

    it("submits a private draft without content and offers no uploader", async () => {
      render(
        <NewSkillModal
          visible
          categories={categories}
          onClose={vi.fn()}
          onCreated={vi.fn()}
          reviewSkill={reviewSkillFixture({ visibility: "private" })}
          reviewInitial={{ changelog: "首次上架" }}
        />,
      );

      expect(screen.getByText(firstListingNotice)).toBeInTheDocument();
      // The plugin row IS the draft here, so there is nothing to upload.
      expect(screen.queryByLabelText(selectNewZipLabel)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(selectZipLabel)).not.toBeInTheDocument();
      expect(screen.queryByText(packageRequiredHint)).not.toBeInTheDocument();

      const submit = screen.getByRole("button", { name: submitReviewButton });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => {
        expect(api.createReviewRequest).toHaveBeenCalledWith({
          pluginId: "skill-pack",
          // bumpPatch of the draft's own version
          version: "1.0.1",
          changelog: "首次上架",
        });
      });
      const call = vi.mocked(api.createReviewRequest).mock.calls[0][0];
      expect("parseTaskId" in call).toBe(false);
      expect("manifestJson" in call).toBe(false);
      expect("pluginJson" in call).toBe(false);
    });

    it("re-submits the same plugin after a failed submit instead of creating a second one", async () => {
      vi.mocked(api.createSkill).mockResolvedValue({ id: "created-1" } as never);
      vi.mocked(api.createReviewRequest)
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({} as never);

      render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

      await act(async () => {
        fireEvent.change(screen.getByLabelText(selectZipLabel), {
          target: { files: [zipFile()] },
        });
      });
      await waitFor(() => expect(screen.getByText("skill-pack.zip")).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "技能包" } });
      fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });
      // Switch the scope to "submit for review" so the create path also submits.
      fireEvent.click(screen.getByRole("radio", { name: /提交组织审核|skillMarket\.review\.scopeReviewLabel/ }));

      const submit = screen.getByRole("button", { name: submitReviewButton });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => expect(api.createReviewRequest).toHaveBeenCalledTimes(1));
      expect(api.createSkill).toHaveBeenCalledTimes(1);

      // Retry: the created plugin id is remembered, so no second orphan plugin.
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => expect(api.createReviewRequest).toHaveBeenCalledTimes(2));
      expect(api.createSkill).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.createReviewRequest).mock.calls[1][0]).toMatchObject({
        pluginId: "created-1",
      });
    });
  });
});
