import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readLoginStyles(): string {
  return fs.readFileSync(
    path.join(repoRoot, "packages/dmworklogin/src/login.css"),
    "utf-8"
  );
}

describe("responsive login brand headline", () => {
  it("wraps only when the brand panel cannot fit the full headline", () => {
    const styles = readLoginStyles();
    const copyRule = styles.match(
      /\.wk-login-brand-copy\s*\{([\s\S]*?)\}/
    )?.[1];
    const headlineRule = styles.match(
      /\.wk-login-brand-headline\s*\{([\s\S]*?)\}/
    )?.[1];

    expect(copyRule).toContain("width: max-content;");
    expect(copyRule).toContain("max-width: 100%;");
    expect(copyRule).toContain("box-sizing: border-box;");
    expect(headlineRule).toContain("white-space: normal;");
    expect(headlineRule).toContain("text-wrap: balance;");
    expect(headlineRule).not.toContain("white-space: nowrap;");
  });
});
