import { describe, expect, it } from "vitest";
import { validateSkillTags } from "./format";

describe("validateSkillTags", () => {
  it("rejects empty and whitespace-only legacy tags", () => {
    expect(validateSkillTags([""])).not.toBeNull();
    expect(validateSkillTags(["   "])).not.toBeNull();
  });

  it("rejects duplicate legacy tags after trimming", () => {
    expect(validateSkillTags(["automation", " automation "])).not.toBeNull();
  });

  it("accepts distinct valid tags", () => {
    expect(validateSkillTags(["automation", "开发工具"])).toBeNull();
  });

  it("allows an unchanged legacy tag longer than the current limit", () => {
    expect(validateSkillTags(["productivity"], ["productivity"])).toBeNull();
  });

  it("rejects a newly added tag longer than the current limit", () => {
    expect(validateSkillTags(["development"], ["productivity"])).not.toBeNull();
  });
});
