import { describe, expect, it } from "vitest";
import { isDriveRootFileNavigation } from "../fileRootGuard";

describe("isDriveRootFileNavigation", () => {
  it("matches Windows drive root with trailing slash", () => {
    expect(isDriveRootFileNavigation("file:///E:/")).toBe(true);
  });

  it("matches Windows drive root without trailing slash", () => {
    expect(isDriveRootFileNavigation("file:///E:")).toBe(true);
  });

  it("matches unix-style root", () => {
    expect(isDriveRootFileNavigation("file:///")).toBe(true);
  });

  it("matches lowercase drive letter", () => {
    expect(isDriveRootFileNavigation("file:///c:/")).toBe(true);
  });

  it("does NOT match a real file path", () => {
    expect(isDriveRootFileNavigation("file:///E:/octo/build/index.html")).toBe(false);
  });

  it("does NOT match a directory-like path (e.g. /login resolved under file://)", () => {
    expect(isDriveRootFileNavigation("file:///E:/login")).toBe(false);
    expect(isDriveRootFileNavigation("file:///E:/space")).toBe(false);
    expect(isDriveRootFileNavigation("file:///E:/drive")).toBe(false);
  });

  it("does NOT match http/https URLs", () => {
    expect(isDriveRootFileNavigation("https://example.com/")).toBe(false);
    expect(isDriveRootFileNavigation("http://localhost:3000/login")).toBe(false);
  });

  it("does NOT match malformed URLs", () => {
    expect(isDriveRootFileNavigation("not a url")).toBe(false);
    expect(isDriveRootFileNavigation("")).toBe(false);
  });

  it("does NOT match file:// paths with subdirectories", () => {
    expect(isDriveRootFileNavigation("file:///E:/some/dir/")).toBe(false);
    expect(isDriveRootFileNavigation("file:///C:/Users/test/report.pdf")).toBe(false);
  });
});
