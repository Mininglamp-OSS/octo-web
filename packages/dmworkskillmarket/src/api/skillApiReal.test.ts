import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WKApp } from "@octo/base";
import {
  getCategories,
  getSkills,
  getMySkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  initUpload,
  uploadFile,
  initReupload,
  triggerParse,
  pollParse,
  getDownloadUrl,
} from "./skillApiReal";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  WKApp.loginInfo.token = "test-token";
  WKApp.shared.currentSpaceId = "space-123";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    status,
    json: () => Promise.resolve({ code: 0, data }),
  });
}

describe("skillApiReal", () => {
  it("getCategories maps snake_case to camelCase", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([
        { id: "dev-tools", name: "开发工具", icon_key: "Terminal", skill_count: 6 },
        { id: "starter", name: "装机必备", icon_key: "Box", skill_count: 3 },
      ]),
    );

    const categories = await getCategories();

    expect(categories).toEqual([
      { id: "dev-tools", name: "开发工具", iconKey: "Terminal", sortOrder: 1, skillCount: 6 },
      { id: "starter", name: "装机必备", iconKey: "Box", sortOrder: 2, skillCount: 3 },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skill/categories",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          token: "test-token",
          "X-Space-Id": "space-123",
        }),
      }),
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

  it("getSkills maps paged result and passes query params", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        items: [
          {
            id: "ci-failure-map",
            name: "ci-failure-map",
            description: "Analyze CI logs",
            category_id: "dev-tools",
            tags: ["CI"],
            owner_id: "jian",
            owner_name: "jian",
            space_id: "dev-space",
            visibility: "space",
            version: "1.0.2",
            readme_content: "# ci-failure-map",
            file_name: "ci-failure-map.zip",
            file_url: "http://localhost/files/ci.zip",
            file_size: 1024,
            file_sha256: "abc123",
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-07-10T00:00:00Z",
          },
        ],
        next_cursor: "abc",
      }),
    );

    const result = await getSkills({ q: "CI", categoryId: "dev-tools", limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].categoryId).toBe("dev-tools");
    expect(result.items[0].fileSha256).toBe("abc123");
    expect(result.nextCursor).toBe("abc");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/market/api/v1/skill?"),
      expect.anything(),
    );
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q=CI");
    expect(url).toContain("category_id=dev-tools");
    expect(url).toContain("limit=10");
  });

  it("getMySkills calls /skill/mine endpoint", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ items: [], next_cursor: null }),
    );

    const result = await getMySkills({ q: "test" });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/skill/mine");
    expect(url).toContain("q=test");
  });

  it("getSkill maps a single skill", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        id: "test-skill",
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
      }),
    );

    const skill = await getSkill("test-skill");

    expect(skill.id).toBe("test-skill");
    expect(skill.categoryId).toBe("other");
    expect(skill.readmeContent).toBe("# Test");
    expect(skill.fileSha256).toBe("def456");
  });

  it("deleteSkill handles 204 response", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ status: 204, json: () => Promise.resolve({}) }),
    );

    await expect(deleteSkill("some-id")).resolves.toBeUndefined();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/skill/some-id");
  });

  it("throws ApiError on non-zero code", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        status: 404,
        json: () => Promise.resolve({ code: "err.marketplace.not_found", message: "not found" }),
      }),
    );

    const request = getSkill("nonexistent");

    await expect(request).rejects.toThrow("not found");
    await expect(request).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "err.marketplace.not_found",
      status: 404,
      message: "not found",
    });
  });

  it("normalizes HTTP and network errors into SkillMarketApiError", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: "server exploded" }),
      }),
    );
    await expect(getCategories()).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "http_500",
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
      id: "new-skill",
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
      "/market/api/v1/skill",
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
      }),
    );

    mockFetch.mockReturnValueOnce(jsonResponse(rawSkill));
    await updateSkill("new-skill", { parseTaskId: "task-2", visibility: "private" });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/market/api/v1/skill/new-skill",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ parse_task_id: "task-2", visibility: "private" }),
      }),
    );
  });

  it("initUpload maps backend presigned upload fields", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        upload_id: "upload-123",
        presigned_url: "http://127.0.0.1:9000/bucket/upload-123.zip",
        method: "PUT",
        headers: { "Content-Type": "application/zip" },
        expires_in: 3600,
      }),
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
      "/market/api/v1/skill/upload/init",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ file_name: "skill-pack.zip", file_size: 2048 }),
      }),
    );
  });

  it("initReupload maps backend presigned upload fields", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        upload_id: "reupload-456",
        presigned_url: "http://127.0.0.1:9000/bucket/reupload-456.zip",
        method: "PUT",
        headers: { "Content-Type": "application/zip", "X-Amz-Acl": "private" },
        expires_in: 1800,
      }),
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
      "/market/api/v1/skill/skill-1/reupload/init",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ file_name: "updated.zip", file_size: 4096 }),
      }),
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
        this.upload.dispatchEvent(new ProgressEvent("progress", {
          lengthComputable: true,
          loaded: 50,
          total: 100,
        }));
        this.listeners.load?.forEach((listener) => listener());
      }
    }
    vi.stubGlobal("XMLHttpRequest", function XHRFactory() {
      const xhr = new MockXHR();
      xhrInstances.push(xhr);
      return xhr;
    });
    const onProgress = vi.fn();

    await uploadFile("https://storage/upload", new File(["zip"], "skill.zip", { type: "application/zip" }), {
      "Content-Type": "application/zip",
      "x-amz-meta-id": "upload-1",
    }, onProgress);

    expect(xhrInstances[0].method).toBe("PUT");
    expect(xhrInstances[0].url).toBe("https://storage/upload");
    expect(xhrInstances[0].headers).toEqual({
      "Content-Type": "application/zip",
      "x-amz-meta-id": "upload-1",
    });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("triggerParse returns the backend task id", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ task_id: "task-123" }));

    await expect(triggerParse("upload-123")).resolves.toEqual({ taskId: "task-123" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skill/upload/upload-123/parse",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pollParse polls every 2s until success and maps nested result", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockReturnValueOnce(jsonResponse({ status: "pending", task_id: "task-123" }))
      .mockReturnValueOnce(jsonResponse({ status: "parsing", task_id: "task-123" }))
      .mockReturnValueOnce(
        jsonResponse({
          status: "success",
          task_id: "task-123",
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
        }),
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
      "/market/api/v1/skill/parse/task-123",
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("pollParse throws nested failure error from backend", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        status: "failed",
        task_id: "task-404",
        error: {
          code: "err.marketplace.parse.invalid_zip",
          message: "invalid zip",
        },
      }),
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
      mockFetch.mockReturnValueOnce(jsonResponse({ status: "pending", task_id: "task-timeout" }));
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
      "/market/api/v1/skill/skill%2Fwith%20space/download",
    );
  });

  it("normalizes tags when backend returns a JSON-encoded string", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        id: "test-skill",
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
      }),
    );

    const skill = await getSkill("test-skill");

    expect(skill.tags).toEqual(["CI", "debug"]);
  });

  it("normalizes tags when backend returns null or undefined", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        id: "test-skill",
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
      }),
    );

    const skill = await getSkill("test-skill");

    expect(skill.tags).toEqual([]);
  });

  it("handles 401 by throwing with unauthorized code", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        status: 401,
        json: () => Promise.resolve({ code: "unauthorized", message: "token expired" }),
      }),
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
      }),
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
        id: "minimal-skill",
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
      }),
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
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("getSkills passes signal to fetch", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ items: [], next_cursor: null }),
    );

    const controller = new AbortController();
    await getSkills({ q: "test" }, { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("getMySkills passes signal to fetch", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ items: [], next_cursor: null }),
    );

    const controller = new AbortController();
    await getMySkills({}, { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("pre-aborted signal causes immediate AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }
      return jsonResponse([]);
    });

    await expect(getCategories({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
