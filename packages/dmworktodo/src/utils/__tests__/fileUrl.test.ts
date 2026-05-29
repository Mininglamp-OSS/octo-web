import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveAndGuardUrl } from "../fileUrl";
import { WKApp } from "@octo/base";

// 保存原始 getFileURL 以便每个 case 还原
const originalGetFileURL = WKApp.dataSource.commonDataSource.getFileURL;

describe("resolveAndGuardUrl", () => {
  beforeEach(() => {
    // 每个 case 重置成默认行为 (恒等函数), 避免污染
    WKApp.dataSource.commonDataSource.getFileURL = originalGetFileURL;
    // 把 window.location.origin 固定到 https://example.com, 方便断言绝对路径
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      origin: "https://example.com",
      href: "https://example.com/",
    } as Location);
  });

  it("空 URL 应当返回 null", () => {
    expect(resolveAndGuardUrl(undefined)).toBeNull();
    expect(resolveAndGuardUrl("")).toBeNull();
  });

  it("已经是 https 的绝对 URL 应当原样返回", () => {
    expect(
      resolveAndGuardUrl("https://cdn.example.com/files/a.pdf"),
    ).toBe("https://cdn.example.com/files/a.pdf");
  });

  it("http 绝对 URL 也应通过校验", () => {
    expect(resolveAndGuardUrl("http://cdn.example.com/a.pdf")).toBe(
      "http://cdn.example.com/a.pdf",
    );
  });

  it("相对路径(/oss/...)应当被拼上 origin 变成绝对路径", () => {
    expect(resolveAndGuardUrl("/oss/storage/foo.pdf")).toBe(
      "https://example.com/oss/storage/foo.pdf",
    );
  });

  it("不带 leading slash 的相对路径也应正确拼接, 不出现双斜杠", () => {
    expect(resolveAndGuardUrl("files/bar.png")).toBe(
      "https://example.com/files/bar.png",
    );
  });

  it("getFileURL 把 raw 转成 /static/<hash>/ 路径时, 也应被补成绝对路径", () => {
    WKApp.dataSource.commonDataSource.getFileURL = (raw: string) =>
      "/static/abc/" + raw;
    expect(resolveAndGuardUrl("foo.pdf")).toBe(
      "https://example.com/static/abc/foo.pdf",
    );
  });

  it("getFileURL 直接返回绝对 URL 时不应再拼 origin", () => {
    WKApp.dataSource.commonDataSource.getFileURL = () =>
      "https://oss.aliyuncs.com/x/y.pdf";
    expect(resolveAndGuardUrl("anything")).toBe(
      "https://oss.aliyuncs.com/x/y.pdf",
    );
  });

  it("getFileURL 返回空字符串时应当返回 null", () => {
    WKApp.dataSource.commonDataSource.getFileURL = () => "";
    expect(resolveAndGuardUrl("foo")).toBeNull();
  });

  // ── 危险协议防御 ──
  // 设计意图: 任何非 http(s) 开头的输入 (包括 javascript:/data:/file:/ftp:)
  // 会被拼上 window.location.origin, 退化成普通 GET 请求, 不再触发原协议的
  // 危险行为 (XSS/本地文件访问等)。最终再 isSafeUrl 兜底校验是不是 http(s)://。
  it("javascript: 协议会被退化为普通 GET 请求, 不再触发 XSS", () => {
    const result = resolveAndGuardUrl("javascript:alert(1)");
    expect(result).toBe("https://example.com/javascript:alert(1)");
    expect(result?.startsWith("https://")).toBe(true);
  });

  it("data: 协议会被退化为普通 GET 请求, 不再当作 inline document 解析", () => {
    const result = resolveAndGuardUrl(
      "data:text/html,<script>alert(1)</script>",
    );
    expect(result?.startsWith("https://example.com/")).toBe(true);
    // 关键: 不会以 data: 协议返回
    expect(result?.startsWith("data:")).toBe(false);
  });

  it("file: 协议会被退化为普通 GET 请求, 不再访问本地文件", () => {
    const result = resolveAndGuardUrl("file:///etc/passwd");
    expect(result?.startsWith("https://example.com/")).toBe(true);
    expect(result?.startsWith("file:")).toBe(false);
  });

  it("ftp: 协议会被退化为普通 https GET 请求", () => {
    const result = resolveAndGuardUrl("ftp://example.com/a");
    expect(result?.startsWith("https://example.com/")).toBe(true);
    expect(result?.startsWith("ftp:")).toBe(false);
  });
});
