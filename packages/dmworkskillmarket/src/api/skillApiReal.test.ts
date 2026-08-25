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
} from "./skillApiReal";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  localStorage.clear();
  WKApp.apiClient.config.apiURL = "/api/v1/";
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

function pluginSkillWire(overrides: Record<string, unknown> = {}) {
  return {
    plugin_id: "ci-failure-map",
    plugin_name: "CI 失败分析",
    plugin_type: "skill",
    category_id: "dev-tools",
    tags: ["CI"],
    publisher: "jian",
    owner_id: "jian",
    space_id: "dev-space",
    visibility: "space",
    creator_name: "CI Bot",
    created_by_type: "human",
    icon: "icons/ci.png",
    icon_url: "https://cdn.example.com/icons/ci.png",
    view_count: 7,
    install_count: 0,
    download_count: 3,
    manifest_json: { name: "ci-failure-map", description: "Analyze CI logs" },
    current_version: "1.0.2",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    ...overrides,
  };
}

describe("skillApiReal", () => {
  it("getCategories maps the unified category wire to camelCase", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([
        {
          category_id: "dev-tools",
          name: "开发工具",
          icon_key: "Terminal",
          plugin_count: 6,
        },
        {
          category_id: "starter",
          name: "装机必备",
          icon_key: "Box",
          plugin_count: 3,
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
      "/market/api/v1/plugin_categories?scene_code=default&plugin_type=skill",
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

  it("resolves marketplace requests against the API origin for desktop builds", async () => {
    WKApp.apiClient.config.apiURL = "https://api.example.com/v1/";
    mockFetch.mockReturnValueOnce(jsonResponse([]));

    await getCategories();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://api.example.com/market/api/v1/plugin_categories?"
      ),
      expect.any(Object)
    );
  });

  it("getCategories pins the unified taxonomy scope (legacy q/tags ignored)", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));

    await getCategories({ q: "CI", tags: ["CI", "质量"] });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/plugin_categories?");
    expect(url).toContain("scene_code=default");
    expect(url).toContain("plugin_type=skill");
    expect(url).not.toContain("q=CI");
  });

  it("falls back to localStorage currentSpaceId when WKApp space is not hydrated", async () => {
    WKApp.shared.currentSpaceId = "";
    localStorage.setItem("currentSpaceId", "space-from-storage");
    mockFetch.mockReturnValueOnce(jsonResponse([]));

    await getSkills();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/market/api/v1/plugins?"),
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          token: "test-token",
          "X-Space-Id": "space-from-storage",
        },
      })
    );
  });

  it("getSkills maps the unified plugin list and passes query params", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([pluginSkillWire()], 200, { total: 42, page: 1, page_size: 10 })
    );

    const result = await getSkills({
      q: "CI",
      categoryId: "dev-tools",
      tags: ["CI", "质量"],
      sort: "latest",
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("ci-failure-map");
    expect(result.items[0].name).toBe("ci-failure-map");
    expect(result.items[0].displayName).toBe("CI 失败分析");
    expect(result.items[0].description).toBe("Analyze CI logs");
    expect(result.items[0].categoryId).toBe("dev-tools");
    expect(result.items[0].creatorName).toBe("CI Bot");
    expect(result.items[0].ownerName).toBe("jian");
    expect(result.items[0].iconUrl).toBe("https://cdn.example.com/icons/ci.png");
    expect(result.items[0].version).toBe("1.0.2");
    expect(result.items[0].viewCount).toBe(7);
    expect(result.items[0].downloadCount).toBe(3);
    // 1 * 10 < 42 → the synthesized cursor is the next page number.
    expect(result.nextCursor).toBe("2");
    expect(result.total).toBe(42);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/plugins?");
    expect(url).toContain("scene_code=default");
    expect(url).toContain("plugin_type=skill");
    expect(url).toContain("q=CI");
    expect(url).toContain("category_id=dev-tools");
    expect(url).toContain("tag=CI&tag=%E8%B4%A8%E9%87%8F");
    expect(url).toContain("sort=newest");
    expect(url).toContain("page=1");
    expect(url).toContain("page_size=10");
  });

  it("getSkillTags aggregates suggestions from the unified tag endpoint", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([{ name: "ui-case", count: 4 }])
    );

    const tags = await getSkillTags("ui");

    expect(tags).toEqual([
      {
        name: "ui-case",
        createdBy: undefined,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/plugin_tags?scene_code=default&plugin_type=skill&q=ui&limit=20",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          token: "test-token",
          "X-Space-Id": "space-123",
        },
      })
    );
  });

  it("getMySkills scopes the unified list to mode=mine", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse([], 200, { total: 0, page: 1, page_size: 20 })
    );

    const result = await getMySkills({
      q: "test",
      tags: ["协作"],
      sort: "downloads",
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/plugins?");
    expect(url).toContain("mode=mine");
    expect(url).toContain("q=test");
    expect(url).toContain("tag=%E5%8D%8F%E4%BD%9C");
    expect(url).toContain("sort=downloads");
  });

  it("getSkill maps the plugin detail with package artifacts", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        plugin: pluginSkillWire({
          plugin_json: {
            $schema: "cowork-plugin-package-1.0.json",
            attachments: [
              {
                path: "SKILL.md",
                content_type: "raw",
                mime_type: "text/markdown",
                raw_content: "# Test",
              },
              {
                path: "skill/ref.json",
                content_type: "raw",
                mime_type: "application/json",
                raw_content: JSON.stringify({
                  file_name: "test.zip",
                  file_size: 512,
                  file_sha256: "def456",
                }),
              },
              {
                path: "skill/package.zip",
                content_type: "storage",
                mime_type: "application/zip",
                storage_uri: "plugins/dev-space/attachments/test.zip",
                content_size: 512,
              },
            ],
          },
        }),
        relations: [],
      })
    );

    const skill = await getSkill("ci-failure-map");

    expect(skill.id).toBe("ci-failure-map");
    expect(skill.categoryId).toBe("dev-tools");
    expect(skill.readmeContent).toBe("# Test");
    expect(skill.fileName).toBe("test.zip");
    expect(skill.fileUrl).toBe("plugins/dev-space/attachments/test.zip");
    expect(skill.fileSize).toBe(512);
    expect(skill.fileSha256).toBe("def456");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/market/api/v1/plugins/detail?plugin_id=ci-failure-map");
  });

  it("getSkill derives file metadata from a tree-shaped package", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        plugin: pluginSkillWire({
          plugin_json: {
            $schema: "cowork-plugin-package-1.0.json",
            attachments: [
              {
                path: "SKILL.md",
                content_type: "raw",
                mime_type: "text/markdown",
                raw_content: "# Tree",
                content_size: 6,
              },
              {
                path: "scripts/run.sh",
                content_type: "raw",
                mime_type: "text/x-shellscript",
                raw_content: "echo hi",
                content_size: 7,
              },
              {
                path: "assets/logo.png",
                content_type: "storage",
                mime_type: "image/png",
                storage_uri: "plugins/dev-space/attachments/skill-x-abc.png",
                content_size: 20,
              },
            ],
          },
        }),
        relations: [],
      })
    );

    const skill = await getSkill("tree-skill");

    expect(skill.readmeContent).toBe("# Tree");
    // No legacy pointer: metadata is derived from the attachment tree.
    expect(skill.fileName).toBe(`${skill.name}.zip`);
    expect(skill.fileUrl).toBe("");
    expect(skill.fileSize).toBe(33);
    expect(skill.fileSha256).toBeUndefined();
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
          resource_type: "plugin",
          resource_id: "skill/with space",
          event_type: "view",
        }),
      })
    );
  });

  it("deleteSkill posts the plugin id to the unified delete endpoint", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ deleted: true }));

    await expect(deleteSkill("some-id")).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/plugins/delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ plugin_id: "some-id" }),
      })
    );
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

  it("createSkill imports the parse task through the unified endpoint", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ plugin: pluginSkillWire(), relations: [] })
    );
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
      "/market/api/v1/plugins/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          parse_task_id: "task-1",
          plugin_name: "test",
          name: "New Skill",
          description: "desc",
          category_id: "dev-tools",
          tags: ["tag"],
          visibility: "space",
          version: "1.0.0",
          icon: "",
        }),
      })
    );
  });

  it("updateSkill with a parse task re-imports against the plugin id", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ plugin: pluginSkillWire(), relations: [] })
    );
    await updateSkill("new-skill", {
      parseTaskId: "task-2",
      visibility: "private",
    });
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
    expect(url).toBe("/market/api/v1/plugins/import");
    const body = JSON.parse(init.body as string);
    expect(body.parse_task_id).toBe("task-2");
    expect(body.plugin_id).toBe("new-skill");
    expect(body.visibility).toBe("private");
  });

  it("updateSkill without a parse task merges onto the current documents and upserts", async () => {
    const current = pluginSkillWire({
      plugin_json: {
        $schema: "cowork-plugin-package-1.0.json",
        attachments: [
          {
            path: "manifest.json",
            content_type: "raw",
            mime_type: "application/json",
            raw_content: "{}",
          },
          {
            path: "SKILL.md",
            content_type: "raw",
            mime_type: "text/markdown",
            raw_content: "# keep me",
          },
        ],
      },
    });
    mockFetch.mockReturnValueOnce(jsonResponse({ plugin: current, relations: [] }));
    mockFetch.mockReturnValueOnce(jsonResponse({ plugin: current, relations: [] }));

    await updateSkill("ci-failure-map", { displayName: "改名", tags: ["新标签"] });

    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
    expect(url).toBe("/market/api/v1/plugins/upsert");
    const body = JSON.parse(init.body as string);
    expect(body.plugin.plugin_id).toBe("ci-failure-map");
    expect(body.plugin.plugin_name).toBe("改名");
    expect(body.plugin.tags).toEqual(["新标签"]);
    // icon echoes the stored write-canonical value, not the presigned URL.
    expect(body.plugin.icon).toBe("icons/ci.png");
    const attachments = body.plugin.plugin_json.attachments as Array<{
      path: string;
      raw_content?: string;
    }>;
    // Contract layout: the stale embedded manifest.json is dropped and the
    // rest of the package passes through untouched.
    expect(attachments.some((a) => a.path === "manifest.json")).toBe(false);
    expect(attachments.find((a) => a.path === "SKILL.md")?.raw_content).toBe(
      "# keep me"
    );
    expect(body.plugin.manifest_json.plugin_name).toBe("改名");
    expect(body.plugin.manifest_json.labels).toEqual(["新标签"]);
  });

  it("re-upload without a new icon omits icon so the stored icon is preserved", async () => {
    // Regression (Jerry-Xin B2 / P1-10): EditSkillModal only sets iconUrl when a
    // new icon is chosen, so a package-only re-upload has iconUrl === undefined.
    // The import must NOT send icon:"" (a full-replace that wipes the stored
    // icon) — it must omit icon entirely.
    mockFetch.mockReturnValueOnce(
      jsonResponse({ plugin: pluginSkillWire(), relations: [] })
    );

    await updateSkill("ci-failure-map", {
      parseTaskId: "task-reupload",
      version: "1.1.0",
      changelog: "repackage",
    });

    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
    expect(url).toBe("/market/api/v1/plugins/import");
    const body = JSON.parse(init.body as string);
    expect(body.plugin_id).toBe("ci-failure-map");
    expect("icon" in body).toBe(false);
  });

  it("re-upload with a fresh icon sends the new iconUrl", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ plugin: pluginSkillWire(), relations: [] })
    );

    await updateSkill("ci-failure-map", {
      parseTaskId: "task-reupload",
      version: "1.1.0",
      changelog: "repackage",
      iconUrl: "icons/new.png",
    });

    const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.icon).toBe("icons/new.png");
  });

  it("metadata edit strips unsafe attachment paths from the resubmitted upsert", async () => {
    const current = pluginSkillWire({
      plugin_json: {
        $schema: "cowork-plugin-package-1.0.json",
        attachments: [
          { path: "manifest.json", content_type: "raw", mime_type: "application/json", raw_content: "{}" },
          { path: "SKILL.md", content_type: "raw", mime_type: "text/markdown", raw_content: "# keep" },
          { path: "references/x.md", content_type: "raw", mime_type: "text/markdown", raw_content: "ref" },
          { path: "../evil.md", content_type: "raw", mime_type: "text/markdown", raw_content: "escape" },
          { path: "/abs.md", content_type: "raw", mime_type: "text/markdown", raw_content: "abs" },
          { path: "a\\b.md", content_type: "raw", mime_type: "text/markdown", raw_content: "backslash" },
          { path: "nested/../../deep.md", content_type: "raw", mime_type: "text/markdown", raw_content: "traverse" },
        ],
      },
    });
    mockFetch.mockReturnValueOnce(jsonResponse({ plugin: current, relations: [] }));
    mockFetch.mockReturnValueOnce(jsonResponse({ plugin: current, relations: [] }));

    await updateSkill("ci-failure-map", { displayName: "改名" });

    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
    expect(url).toBe("/market/api/v1/plugins/upsert");
    const body = JSON.parse(init.body as string);
    const paths = (body.plugin.plugin_json.attachments as Array<{ path: string }>).map((a) => a.path);
    // manifest.json dropped (contract), traversal/absolute/backslash paths rejected;
    // only safe relative paths survive into the trusted write.
    expect(paths).toEqual(["SKILL.md", "references/x.md"]);
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
    // Reuploads share the unbound upload channel; the skill binding happens
    // at import time via plugin_id.
    expect(mockFetch).toHaveBeenCalledWith(
      "/market/api/v1/skill_uploads",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ file_name: "updated.zip", file_size: 4096 }),
      })
    );
  });

  it("uploadFile PUTs HTTP and HTTPS presigned URLs with headers and reports progress", async () => {
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

    await uploadFile(
      "http://storage.example/upload",
      new File(["zip"], "skill.zip", { type: "application/zip" })
    );

    expect(xhrInstances[1].method).toBe("PUT");
    expect(xhrInstances[1].url).toBe("http://storage.example/upload");
  });

  it("uploadFile rejects non-HTTP presigned URL schemes", async () => {
    await expect(
      uploadFile(
        "file:///tmp/skill.zip",
        new File(["zip"], "skill.zip", { type: "application/zip" })
      )
    ).rejects.toMatchObject({
      name: "SkillMarketApiError",
      code: "invalid_response",
      message: "URL scheme 不允许",
    });
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

  it("getDownloadUrl exposes the authenticated unified download endpoint", () => {
    expect(getDownloadUrl("skill/with space")).toBe(
      "/market/api/v1/plugins/download?plugin_id=skill%2Fwith%20space"
    );
  });

  it("normalizes tags when backend returns a JSON-encoded string", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        plugin: pluginSkillWire({ tags: '["CI","debug"]' }),
        relations: [],
      })
    );

    const skill = await getSkill("ci-failure-map");

    expect(skill.tags).toEqual(["CI", "debug"]);
  });

  it("normalizes tags when backend returns null or undefined", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        plugin: pluginSkillWire({ tags: null }),
        relations: [],
      })
    );

    const skill = await getSkill("ci-failure-map");

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
        plugin: {
          plugin_id: "minimal-skill",
          plugin_name: "Minimal",
          plugin_type: "skill",
          tags: [],
          owner_id: "u1",
          visibility: null,
          manifest_json: {},
        },
        relations: [],
      })
    );

    const skill = await getSkill("minimal-skill");

    expect(skill.name).toBe("Minimal");
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
        "/market/api/v1/plugins/skill_md?plugin_id=skill-123",
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
