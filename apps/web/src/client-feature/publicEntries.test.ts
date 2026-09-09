import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const require = createRequire(import.meta.url);

describe("artifact public package entries", () => {
  it.each([
    ["@dmwork/summary/communication", "/dmworksummary/src/communication.ts"],
    ["@dmwork/summary/messaging", "/dmworksummary/src/host/index.ts"],
    ["@dmwork/summary/workspace", "/dmworksummary/src/workspace.ts"],
    ["@dmwork/appbot/conversation", "/dmworkappbot/src/conversation.ts"],
    ["@dmwork/appbot/workspace", "/dmworkappbot/src/workspace.ts"],
  ])("resolves %s to a focused entry rather than the full module", (entry, suffix) => {
    expect(require.resolve(entry)).toMatch(new RegExp(suffix.replaceAll("/", "[/\\\\]") + "$"));
    const result = ts.resolveModuleName(
      entry, __filename, { moduleResolution: ts.ModuleResolutionKind.Node10 }, ts.sys
    );
    expect(result.resolvedModule?.resolvedFileName).toMatch(
      new RegExp(suffix.replaceAll("/", "[/\\\\]") + "$")
    );
  });

  it.each(["@dmwork/summary", "@dmwork/appbot"])("preserves %s package metadata access", (entry) => {
    expect(require(`${entry}/package.json`).name).toBe(entry);
  });
});
