import { describe, expect, it, vi } from "vitest";
import { SummaryContentService } from "./SummaryContentService";
import { generationConfigurationFixture, generationFixture } from "../__tests__/formalContentFixtures";
import { decodeGenerationConfiguration } from "../bridge/summaryWorkbench/formalContent";

describe("confirmed configuration transport", () => {
  it("loads an incomplete requirement without inventing title text", async () => {
    const read = vi.fn().mockResolvedValue({ code: 0, data: generationConfigurationFixture() });
    const service = new SummaryContentService({ read });
    const configuration = await service.loadConfiguration(12, "sc1_personal", { spaceId: "space-a" });
    expect(configuration.spec.requirement).toBeNull();
    expect(read).toHaveBeenCalledWith("/summary/api/v1/summaries/12/contents/sc1_personal/configuration", { spaceId: "space-a" });
  });
  it("saving a schedule does not add an implicit generation request", async () => {
    const config = generationConfigurationFixture();
    const command = vi.fn().mockResolvedValue({ code: 0, data: { configuration: { ...config, revision: 1 }, generation: null } });
    const service = new SummaryContentService({ read: vi.fn(), command });
    const result = await service.saveConfiguration(12, "sc1_personal", {
      expected_config_revision: 0, spec: config.spec,
      schedule: { enabled: true, interval_days: 7, interval_months: 0, run_time: "09:00", day_of_week: 0, day_of_month: 0 },
    }, { spaceId: "space-a" });
    expect(command.mock.calls[0][2]).not.toHaveProperty("generate");
    expect(result.generation).toBeNull();
  });
  it("save-and-run sends the frozen baseline, not preview or reference ids", async () => {
    const config = generationConfigurationFixture(), run = generationFixture();
    const command = vi.fn().mockResolvedValue({ configuration: { ...config, revision: 1 }, generation: run });
    const service = new SummaryContentService({ read: vi.fn(), command });
    const request = {
      expected_config_revision: 0, spec: config.spec,
      generate: { content_id: "sc1_personal", expected_current_version_id: "sv1_first", expected_content_revision: 1, expected_config_revision: 0, idempotency_key: "same-intent" },
    };
    await service.saveConfiguration(12, "sc1_personal", request, { spaceId: "space-a" });
    expect(command.mock.calls[0][2].generate).toEqual({
      expected_current_version_id: "sv1_first", expected_content_revision: 1, expected_config_revision: 0, idempotency_key: "same-intent",
    });
    await expect(service.saveConfiguration(12, "sc1_other", request, { spaceId: "space-a" })).rejects.toThrow();
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("rejects a cross-Space generation result", async () => {
    const command = vi.fn().mockResolvedValue({ ...generationFixture(), space_id: "space-b" });
    const service = new SummaryContentService({ read: vi.fn(), command });
    await expect(service.regenerateCurrent(12, {
      content_id: "sc1_personal", expected_current_version_id: "sv1_first", expected_content_revision: 1, expected_config_revision: 1, idempotency_key: "key",
    }, { spaceId: "space-a" })).rejects.toThrow();
  });
  it("rejects a different collaboration mode and malformed time selector", () => {
    const config = generationConfigurationFixture();
    expect(() => decodeGenerationConfiguration({ ...config, spec: { ...config.spec, collaboration: "team" } })).toThrow();
    expect(() => decodeGenerationConfiguration({ ...config, spec: { ...config.spec, time_selector: { mode: "guess" } } })).toThrow();
  });
});
