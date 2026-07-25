import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WKApp } from "@octo/base";
import {
  getCategories,
  getSkills,
  getMySkills,
  getSkillTags,
  getSkill,
  trackSkillView,
  getSkillMd,
  createSkill,
  updateSkill,
  deleteSkill,
  initUpload,
  uploadFile,
  initReupload,
  triggerParse,
  pollParse,
  getDownloadUrl,
  downloadSkill,
} from "./skillApiReal";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  localStorage.clear();
  WKApp.loginInfo.token = "test-token";
  WKApp.shared.currentSpaceId = "space-123";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200, pagination?: unknown) {
  return Promise.resolve({
    status,
    json: () =>
      Promise.resolve({ data, ...(pagination ? { pagination } : {}) }),
  });
}

describe("skillApiReal", () => {
  it("getCategories maps snake_case to camelCase", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([
        {
          skill_category_id: "dev-tools",
          name: "开发工具",
          icon_key: "Terminal",
          skill_count: 6,
        },
        {
          skill_category_id: "starter",
          name: "装机必备",
          icon_key: "Box",
          skill_count: 3,
        },
      ])
    );

    const categories = await getCategories();

    expect(categories).toEqual([
      {
        id: "dev-tools",
        name: "开发工具",
        iconKey: "Terminal",
        sortOrder: 1,
        skillCount: 6,
      },
      {
        id: "starter",
        name: "装机必备",
        iconKey: "Box",
        sortOrder: 2,
        skillCount: 3,
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skill_categories",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          token: "test-token",
          "X-Space-Id": "space-123",
        },
      })
    );
  });

  it("omits auth and space headers when host context is empty", async () => {
    WKApp.loginInfo.token = "";
    WKApp.shared.currentSpaceId = "";
    mockFetch.mockReturnValueOnce(jsonResponse([]));

    await getCategories();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).toEqual({ "Content-Type": "application/json" });
  });

  it("falls back to localStorage currentSpaceId when WKApp space is not hydrated", async () => {
    WKApp.shared.currentSpaceId = "";
    localStorage.setItem("currentSpaceId", "space-from-storage");
    mockFetch.mockReturnValueOnce(jsonResponse([]));

    await getSkills();

    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skills",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          token: "test-token",
          "X-Space-Id": "space-from-storage",
        },
      })
    );
  });

  it("getSkills maps paged result and passes query params", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse(
        [
          {
            skill_id: "ci-failure-map",
            name: "ci-failure-map",
            description: "Analyze CI logs",
            category_id: "dev-tools",
            tags: ["CI"],
            owner_id: "jian",
            owner_name: "jian",
            creator_id: "bot-1",
            creator_name: "CI Bot",
            space_id: "dev-space",
            visibility: "space",
            version: "1.0.2",
            readme_content: "# ci-failure-map",
            file_name: "ci-failure-map.zip",
            file_url: "http://localhost/files/ci.zip",
            file_size: 1024,
            file_sha256: "abc123",
            view_count: 7,
            download_count: 3,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-07-10T00:00:00Z",
          },
        ],
        200,
        { has_more: true, next_cursor: "abc", total: 42 }
      )
    );

    const result = await getSkills({
      q: "CI",
      categoryId: "dev-tools",
      tags: ["CI", "质量"],
      sort: "latest",
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].categoryId).toBe("dev-tools");
    expect(result.items[0].creatorName).toBe("CI Bot");
    expect(result.items[0].fileSha256).toBe("abc123");
    expect(result.items[0].viewCount).toBe(7);
    expect(result.items[0].downloadCount).toBe(3);
    expect(result.nextCursor).toBe("abc");
    expect(result.total).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/market/api/v1/skills?"),
      expect.anything()
    );
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q=CI");
    expect(url).toContain("category_id=dev-tools");
    expect(url).toContain("tags=CI%2C%E8%B4%A8%E9%87%8F");
    expect(url).toContain("sort=latest");
    expect(url).toContain("page_size=10");
  });

  it("getSkillTags fetches current-space tag suggestions", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        items: [
          {
            name: "ui-case",
            created_by: "dev-user",
            created_at: "2026-07-17T09:04:23Z",
            updated_at: "2026-07-17T09:04:23Z",
          },
        ],
      })
    );

    const tags = await getSkillTags("ui");

    expect(tags).toEqual([
      {
        name: "ui-case",
        createdBy: "dev-user",
        createdAt: "2026-07-17T09:04:23Z",
        updatedAt: "2026-07-17T09:04:23Z",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skills/tags?q=ui&page_size=20",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          token: "test-token",
          "X-Space-Id": "space-123",
        },
      })
    );
  });

  it("getMySkills calls /skill/mine endpoint", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([], 200, { has_more: false }));

    const result = await getMySkills({
      q: "test",
      tags: ["协作"],
      sort: "downloads",
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/skills/mine");
    expect(url).toContain("q=test");
    expect(url).toContain("tags=%E5%8D%8F%E4%BD%9C");
    expect(url).toContain("sort=downloads");
  });

  it("getSkill maps a single skill", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        skill_id: "test-skill",
        name: "Test",
        description: "desc",
        category_id: "other",
        tags: ["a"],
        owner_id: "u1",
        owner_name: "User",
        space_id: "s1",
        visibility: "public",
        version: "1.0.0",
        readme_content: "# Test",
        file_name: "test.zip",
        file_url: "/files/test.zip",
        file_size: 512,
        file_sha256: "def456",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      })
    );

    const skill = await getSkill("test-skill");

    expect(skill.id).toBe("test-skill");
    expect(skill.categoryId).toBe("other");
    expect(skill.readmeContent).toBe("# Test");
    expect(skill.fileSha256).toBe("def456");
  });

  it("keeps detail navigation working during an id field rolling upgrade", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        id: "legacy-skill",
        name: "Legacy",
        category_id: "other",
        tags: [],
        owner_id: "u1",
        space_id: "s1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      })
    );

    await expect(getSkill("legacy-skill")).resolves.toMatchObject({
      id: "legacy-skill",
    });
  });

  it("trackSkillView sends a best-effort view metric", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));

    await expect(trackSkillView("skill/with space")).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/metrics/track",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          token: "test-token",
          "X-Space-Id": "space-123",
        }),
        body: JSON.stringify({
          resource_type: "skill",
          resource_id: "skill/with space",
          event_type: "view",
        }),
      })
    );
  });

  it("deleteSkill handles empty success envelope", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));

    await expect(deleteSkill("some-id")).resolves.toBeUndefined();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/skills/some-id");
  });

  it("deleteSkill handles a real 204 No Content (empty body)", async () => {
    // Regression: the shared envelope parser used to throw `invalid_response`
    // for any success without a JSON `data` field, so a real 204 succeeded
    // server-side but the UI reported failure and never refreshed. Simulate
    // the empty body Response.json() rejects with SyntaxError shape.
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        status: 204,
        ok: true,
        json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      })
    );

    await expect(deleteSkill("some-id")).resolves.toBeUndefined();
  });

  it("throws ApiError on non-zero code", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        status: 404,
        json: () =>
          Promise.resolve({
            error: { code: "NOT_FOUND", message: "not found", details: {} },
          }),
      })
    );

    const request = getSkill("nonexistent");

    await expect(request).rejects.toThrow("not found");
    await expect(request).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "NOT_FOUND",
      status: 404,
      message: "not found",
    });
  });

  it("normalizes HTTP and network errors into SkillMarketApiError", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            error: {
              code: "INTERNAL_ERROR",
              message: "server exploded",
              details: {},
            },
          }),
      })
    );
    await expect(getCategories()).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "INTERNAL_ERROR",
      status: 500,
      message: "server exploded",
    });

    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(getCategories()).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "network_error",
      message: "Failed to fetch",
    });
  });

  it("createSkill and updateSkill send backend snake_case payloads", async () => {
    const rawSkill = {
      skill_id: "new-skill",
      name: "New Skill",
      description: "desc",
      category_id: "dev-tools",
      tags: ["tag"],
      owner_id: "u1",
      owner_name: "User",
      space_id: "s1",
      visibility: "space",
      version: "1.0.0",
      readme_content: "# New Skill",
      file_name: "skill.zip",
      file_url: "/files/skill.zip",
      file_size: 512,
      file_sha256: "sha",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };
    mockFetch.mockReturnValueOnce(jsonResponse(rawSkill));
    await createSkill({
      parseTaskId: "task-1",
      name: "New Skill",
      displayName: "test",
      description: "desc",
      categoryId: "dev-tools",
      tags: ["tag"],
      visibility: "space",
      version: "1.0.0",
      readmeContent: "# ignored by API",
      fileName: "skill.zip",
      fileSize: 512,
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/market/api/v1/skills",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          parse_task_id: "task-1",
          name: "New Skill",
          display_name: "test",
          description: "desc",
          category_id: "dev-tools",
          tags: ["tag"],
          visibility: "space",
          version: "1.0.0",
          icon_url: "",
        }),
      })
    );

    mockFetch.mockReturnValueOnce(jsonResponse(rawSkill));
    await updateSkill("new-skill", {
      parseTaskId: "task-2",
      visibility: "private",
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/market/api/v1/skills/new-skill",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          parse_task_id: "task-2",
          visibility: "private",
        }),
      })
    );
  });

  it("initUpload maps backend presigned upload fields", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        skill_upload_id: "upload-123",
        presigned_url: "http://127.0.0.1:9000/bucket/upload-123.zip",
        method: "PUT",
        headers: { "Content-Type": "application/zip" },
        expires_in: 3600,
      })
    );

    const result = await initUpload("skill-pack.zip", 2048);

    expect(result).toEqual({
      uploadId: "upload-123",
      presignedUrl: "http://127.0.0.1:9000/bucket/upload-123.zip",
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      expiresIn: 3600,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skill_uploads",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ file_name: "skill-pack.zip", file_size: 2048 }),
      })
    );
  });

  it("initReupload maps backend presigned upload fields", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        skill_upload_id: "reupload-456",
        presigned_url: "http://127.0.0.1:9000/bucket/reupload-456.zip",
        method: "PUT",
        headers: { "Content-Type": "application/zip", "X-Amz-Acl": "private" },
        expires_in: 1800,
      })
    );

    const result = await initReupload("skill-1", "updated.zip", 4096);

    expect(result).toEqual({
      uploadId: "reupload-456",
      presignedUrl: "http://127.0.0.1:9000/bucket/reupload-456.zip",
      method: "PUT",
      headers: { "Content-Type": "application/zip", "X-Amz-Acl": "private" },
      expiresIn: 1800,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skills/skill-1/reuploads",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ file_name: "updated.zip", file_size: 4096 }),
      })
    );
  });

  it("uploadFile PUTs with presigned headers and reports progress", async () => {
    const xhrInstances: MockXHR[] = [];
    class MockXHR {
      upload = new EventTarget();
      headers: Record<string, string> = {};
      method = "";
      url = "";
      status = 204;
      private listeners: Record<string, Array<() => void>> = {};

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners[type] = [...(this.listeners[type] ?? []), listener];
      }

      send(body: File) {
        expect(body.name).toBe("skill.zip");
        this.upload.dispatchEvent(
          new ProgressEvent("progress", {
            lengthComputable: true,
            loaded: 50,
            total: 100,
          })
        );
        this.listeners.load?.forEach((listener) => listener());
      }
    }
    vi.stubGlobal("XMLHttpRequest", function XHRFactory() {
      const xhr = new MockXHR();
      xhrInstances.push(xhr);
      return xhr;
    });
    const onProgress = vi.fn();

    await uploadFile(
      "https://storage/upload",
      new File(["zip"], "skill.zip", { type: "application/zip" }),
      {
        "Content-Type": "application/zip",
        "x-amz-meta-id": "upload-1",
      },
      onProgress
    );

    expect(xhrInstances[0].method).toBe("PUT");
    expect(xhrInstances[0].url).toBe("https://storage/upload");
    expect(xhrInstances[0].headers).toEqual({
      "Content-Type": "application/zip",
      "x-amz-meta-id": "upload-1",
    });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("triggerParse returns the backend task id", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ skill_parse_task_id: "task-123" })
    );

    await expect(triggerParse("upload-123")).resolves.toEqual({
      taskId: "task-123",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skill_uploads/upload-123/parse",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("pollParse polls every 2s until success and maps nested result", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockReturnValueOnce(
        jsonResponse({ status: "pending", skill_parse_task_id: "task-123" })
      )
      .mockReturnValueOnce(
        jsonResponse({ status: "parsing", skill_parse_task_id: "task-123" })
      )
      .mockReturnValueOnce(
        jsonResponse({
          status: "success",
          skill_parse_task_id: "task-123",
          result: {
            name: "ci-failure-map",
            description: "Analyze CI logs",
            tags: ["CI", "debug"],
            version: "1.2.3",
            readme_content: "# ci-failure-map",
            file_name: "ci-failure-map.zip",
            file_size: 8192,
            file_sha256: "abc123",
          },
        })
      );

    const pending = pollParse("task-123");
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result).toEqual({
      status: "success",
      result: {
        name: "ci-failure-map",
        description: "Analyze CI logs",
        tags: ["CI", "debug"],
        version: "1.2.3",
        readmeContent: "# ci-failure-map",
        fileName: "ci-failure-map.zip",
        fileSize: 8192,
        fileSha256: "abc123",
      },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skill_parse_tasks/task-123",
      expect.anything()
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("pollParse throws nested failure error from backend", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        status: "failed",
        skill_parse_task_id: "task-404",
        error: {
          code: "err.marketplace.parse.invalid_zip",
          message: "invalid zip",
        },
      })
    );

    await expect(pollParse("task-404")).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "err.marketplace.parse.invalid_zip",
      message: "invalid zip",
    });
  });

  it("pollParse times out after 60 pending attempts", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 60; i += 1) {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ status: "pending", skill_parse_task_id: "task-timeout" })
      );
    }

    const pending = pollParse("task-timeout");
    const assertion = expect(pending).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "parse_timeout",
      message: "解析超时，请重试",
    });
    await vi.advanceTimersByTimeAsync(2_000 * 60);

    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(60);
    vi.useRealTimers();
  });

  it("getDownloadUrl exposes the backend 302 download endpoint", () => {
    expect(getDownloadUrl("skill/with space")).toBe(
      "/market/api/v1/skills/skill%2Fwith%20space/download"
    );
  });

  it("downloads through an authenticated JSON URL request", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ download_url: "https://cdn.example.com/skills/demo.zip" })
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await downloadSkill("skill/with space");

    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skills/skill%2Fwith%20space/download?format=json",
      expect.objectContaining({
        headers: expect.objectContaining({
          token: "test-token",
          "X-Space-Id": "space-123",
        }),
      })
    );
    expect(click).toHaveBeenCalledOnce();
  });

  it("normalizes tags when backend returns a JSON-encoded string", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        skill_id: "test-skill",
        name: "Test",
        description: "desc",
        category_id: "other",
        tags: '["CI","debug"]',
        owner_id: "u1",
        owner_name: "User",
        space_id: "s1",
        visibility: "public",
        version: "1.0.0",
        readme_content: "# Test",
        file_name: "test.zip",
        file_url: "/files/test.zip",
        file_size: 512,
        file_sha256: "def456",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      })
    );

    const skill = await getSkill("test-skill");

    expect(skill.tags).toEqual(["CI", "debug"]);
  });

  it("normalizes tags when backend returns null or undefined", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        skill_id: "test-skill",
        name: "Test",
        description: "desc",
        category_id: "other",
        tags: null,
        owner_id: "u1",
        owner_name: "User",
        space_id: "s1",
        visibility: "public",
        version: "1.0.0",
        readme_content: "# Test",
        file_name: "test.zip",
        file_url: "/files/test.zip",
        file_size: 512,
        file_sha256: "def456",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      })
    );

    const skill = await getSkill("test-skill");

    expect(skill.tags).toEqual([]);
  });

  it("handles 401 by throwing with unauthorized code", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        status: 401,
        json: () =>
          Promise.resolve({ code: "unauthorized", message: "token expired" }),
      })
    );

    // Mock window.location
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });

    await expect(getCategories()).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "unauthorized",
      message: "登录已过期，请重新登录",
      status: 401,
    });

    expect(window.location.href).toBe("/login");
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("handles 413 with a clear file-too-large message", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        status: 413,
        json: () => Promise.resolve({}),
      })
    );

    await expect(getSkill("big-file")).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "file_too_large",
      message: "文件过大，请压缩后重试",
      status: 413,
    });
  });

  it("defaults missing skill fields to safe values", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        skill_id: "minimal-skill",
        name: "Minimal",
        description: null,
        category_id: "other",
        tags: [],
        owner_id: "u1",
        owner_name: null,
        space_id: "s1",
        visibility: null,
        version: null,
        readme_content: null,
        file_name: null,
        file_url: null,
        file_size: null,
        file_sha256: "abc",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      })
    );

    const skill = await getSkill("minimal-skill");

    expect(skill.description).toBe("");
    expect(skill.ownerName).toBe("");
    expect(skill.visibility).toBe("space");
    expect(skill.version).toBe("1.0.0");
    expect(skill.readmeContent).toBe("");
    expect(skill.fileName).toBe("");
    expect(skill.fileUrl).toBe("");
    expect(skill.fileSize).toBe(0);
  });

  it("getCategories passes signal to fetch and aborts correctly", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(() => {
      return new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const promise = getCategories({ signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("getSkills passes signal to fetch", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([], 200, { has_more: false }));

    const controller = new AbortController();
    await getSkills({ q: "test" }, { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("getMySkills passes signal to fetch", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([], 200, { has_more: false }));

    const controller = new AbortController();
    await getMySkills({}, { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("pre-aborted signal causes immediate AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(
          new DOMException("The operation was aborted.", "AbortError")
        );
      }
      return jsonResponse([]);
    });

    await expect(
      getCategories({ signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  describe("getSkillMd", () => {
    it("returns markdown text on success", async () => {
      const mdText = "# My Skill\n\nThis is a skill description.";
      mockFetch.mockReturnValueOnce(jsonResponse({ content: mdText }));

      const result = await getSkillMd("skill-123");
      expect(result).toBe(mdText);
      expect(mockFetch).toHaveBeenCalledWith(
        "/market/api/v1/skills/skill-123/skill_md",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            token: "test-token",
            "X-Space-Id": "space-123",
          },
        })
      );
    });

    it("throws with status 404 when skill-md not found", async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () =>
            Promise.resolve({
              error: {
                code: "NOT_FOUND",
                message: "SKILL.md not found",
                details: {},
              },
            }),
        })
      );

      await expect(getSkillMd("skill-missing")).rejects.toMatchObject({
        status: 404,
        code: "NOT_FOUND",
      });
    });

    it("throws on network error", async () => {
      mockFetch.mockReturnValueOnce(
        Promise.reject(new Error("Network failure"))
      );

      await expect(getSkillMd("skill-123")).rejects.toMatchObject({
        code: "network_error",
      });
    });

    it("propagates AbortError without wrapping", async () => {
      const abortError = new DOMException("Aborted", "AbortError");
      mockFetch.mockReturnValueOnce(Promise.reject(abortError));

      await expect(getSkillMd("skill-123")).rejects.toMatchObject({
        name: "AbortError",
      });
    });
  });
});
