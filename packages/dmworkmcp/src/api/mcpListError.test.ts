import { describe, expect, it } from "vitest";
import { classifyMcpListError, executeMcpListRequest, McpListError, mcpListErrorI18nKey } from "./mcpListError";

describe("classifyMcpListError", () => {
  it.each([[401, "auth"], [403, "forbidden"], [500, "server"], [503, "server"]])("maps http %s", (status, expected) => {
    expect(classifyMcpListError({ response: { status } })).toBe(expected);
  });
  it("maps network errors without a response", () => {
    expect(classifyMcpListError({ code: "ERR_NETWORK" })).toBe("network");
  });
  it.each([[401, "auth"], [403, "forbidden"], [500, "server"]])("preserves classification through the service request boundary", async (status, kind) => {
    await expect(executeMcpListRequest(() => Promise.reject({ response: { status } }))).rejects.toMatchObject({ name: "Error", kind });
  });
  it("preserves an already classified page error", async () => {
    const error = new McpListError("network");
    await expect(executeMcpListRequest(() => Promise.reject(error))).rejects.toBe(error);
  });
  it("carries a service failure through to the page-specific error key", async () => {
    try { await executeMcpListRequest(() => Promise.reject({ response: { status: 403 } })); }
    catch (err) { expect(mcpListErrorI18nKey(err)).toBe("mcp.list.error.forbidden"); }
  });
});
