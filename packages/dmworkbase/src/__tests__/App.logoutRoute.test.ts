import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const packageRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(packageRoot, relativePath), "utf-8");
}

describe("WKApp logout route reset", () => {
  it("does not reload the pre-logout business route", () => {
    const source = readRepoFile("src/App.tsx");
    const logoutStart = source.indexOf("  logout() {");
    const logoutEnd = source.indexOf("  async logoutUserInitiated()", logoutStart);
    const logoutSource = source.slice(logoutStart, logoutEnd);

    expect(logoutSource).toContain('window.location.replace("/login")');
    expect(source).toContain('setSessionSid("")');
    expect(logoutSource).not.toContain("window.location.reload()");
  });
});

describe("RouteManager browser history handling", () => {
  it("renders browser history events without pushing a new history entry", () => {
    const source = readRepoFile("src/Service/Route.tsx");
    const popStart = source.indexOf("  private handlePopState");
    const constructorStart = source.indexOf("  private constructor()", popStart);
    const historyHandlersSource = source.slice(popStart, constructorStart);
    const renderStart = source.indexOf("  renderCurrentPath(");
    const pushStart = source.indexOf("  push(", renderStart);
    const renderSource = source.slice(renderStart, pushStart);

    expect(historyHandlersSource).toContain("renderCurrentPath(window.location.pathname)");
    expect(historyHandlersSource).not.toContain(".push(window.location.pathname)");
    expect(renderSource).toContain("WKApp.shared.restContent(component)");
    expect(renderSource).not.toContain("window.history.pushState");
  });
});
