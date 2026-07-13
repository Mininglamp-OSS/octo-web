import { describe, it, expect } from "vitest";
import { isSafeUrl, isHttpsUrl } from "../security";

describe("isSafeUrl", () => {
  it("允许 http / https 绝对 URL（链接面）", () => {
    expect(isSafeUrl("https://example.com/a")).toBe(true);
    expect(isSafeUrl("http://example.com/a")).toBe(true);
  });

  it("拦截 javascript: / data: / vbscript: 等危险 scheme", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox")).toBe(false);
  });

  it("拦截 app 深链 octo:// 与相对路径 / 非法值", () => {
    expect(isSafeUrl("octo://open")).toBe(false);
    expect(isSafeUrl("/relative/path")).toBe(false);
    expect(isSafeUrl("example.com")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
  });
});

describe("isHttpsUrl（图片面：混合内容防护）", () => {
  it("仅允许 https", () => {
    expect(isHttpsUrl("https://cdn.example.com/x.png")).toBe(true);
  });

  it("拒绝 http（HTTPS 页面混合内容 → 走占位，不自动升级）", () => {
    expect(isHttpsUrl("http://cdn.example.com/x.png")).toBe(false);
  });

  it("拒绝 javascript: / data: / octo:// / 相对路径 / 空值", () => {
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("data:image/png;base64,AAA")).toBe(false);
    expect(isHttpsUrl("octo://open")).toBe(false);
    expect(isHttpsUrl("/x.png")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
  });
});
