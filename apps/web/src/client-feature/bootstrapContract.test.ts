import { describe, expect, it } from "vitest";
import fixtures from "./client-feature-contract-v1.fixture.json";
import {
  assertClientFeatureBootstrap,
  type ClientFeatureId,
} from "./bootstrapContract";

describe("client feature bootstrap contract v1", () => {
  it("accepts the shared valid fixtures", () => {
    for (const fixture of fixtures.valid) {
      expect(() =>
        assertClientFeatureBootstrap(
          fixture.value,
          fixture.featureId as ClientFeatureId
        )
      ).not.toThrow();
    }
  });

  it("rejects the shared invalid fixtures", () => {
    for (const fixture of fixtures.invalid) {
      expect(
        () =>
          assertClientFeatureBootstrap(
            fixture.value,
            fixture.featureId as ClientFeatureId
          ),
        fixture.name
      ).toThrow();
    }
  });
});
