import { describe, expect, it } from "vitest";
import { parseMcpListQuery, serializeMcpListQuery } from "./mcpListQuery";

it("round-trips keyword, tag and verification multi-select filters", () => {
  const state = parseMcpListQuery("?keyword=issue&tag=browser&tag=github&verification_status=verified&verification_status=error&sort=verified");
  expect(state.tags).toEqual(["browser", "github"]); expect(state.verificationStatuses).toEqual(["verified", "error"]);
  expect(parseMcpListQuery(`?${serializeMcpListQuery(state)}`)).toEqual(state);
});
