import { describe, expect, it } from "vitest";
import { toWireParams } from "./mcpWireParams";
import type { CreateMcpParams } from "../types/mcp";

const form: CreateMcpParams = {
  name: "GitHub MCP",
  slug: "github-mcp",
  category: "dev",
  icon: "",
  tags: [],
  slogan: "Issues and pull requests",
  transport: "streamable-http",
  url: "https://mcp.example.com/github",
  tools: [],
  usageExamples: [],
  faqs: [],
  notes: [],
};

describe("toWireParams visibility", () => {
  it("omits visibility from create and edit payloads", () => {
    const payload = toWireParams(form);

    expect(payload).not.toHaveProperty("visibility");
    expect(payload).toMatchObject({
      name: "GitHub MCP",
      slug: "github-mcp",
      transport: "streamable-http",
    });
  });
});
