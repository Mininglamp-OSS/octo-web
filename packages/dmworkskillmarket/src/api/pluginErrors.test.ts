import { describe, expect, it, vi } from "vitest";
vi.mock("@octo/base", () => ({ t: (key: string) => key }));
import { pluginErrorMessage } from "./pluginErrors";
describe("plugin errors", () => {
  it.each([
    ["DUPLICATE", { conflict_reason: "name_taken" }, "nameTaken"],
    ["CONFLICT", { conflict_reason: "state" }, "stateConflict"],
    ["CONFLICT", undefined, "stateConflict"],
    ["CONFLICT", { conflict_reason: "review_pending" }, "reviewPending"],
    ["CONFLICT", { conflict_reason: "label_taken" }, "labelTaken"],
    ["CONFLICT", { conflict_reason: "relation_in_use" }, "relationInUse"],
    ["BAD_REQUEST", { reason: "dependency_visibility" }, "dependencyVisibility"],
  ])("maps %s %j to its actual cause", (code, details, key) => {
    expect(pluginErrorMessage(code, details)).toBe(`skillMarket.errors.${key}`);
  });
});
