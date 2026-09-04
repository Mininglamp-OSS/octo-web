import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("apps artifact startup", () => {
  it("does not invoke the application startup path that connects IM", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "index.tsx"),
      "utf8"
    );
    expect(source).not.toContain("WKApp.shared.startup(");
    expect(source).not.toContain("connectIM(");
  });
});
