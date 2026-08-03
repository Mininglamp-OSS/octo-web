import type { CreateMcpParams, UpdateMcpParams } from "../types/mcp";

export function toWireParams(params: CreateMcpParams | UpdateMcpParams) {
  return {
    name: params.name,
    slug: params.slug,
    slogan: params.slogan,
    category: params.category,
    icon: params.icon,
    tags: params.tags,
    transport: params.transport,
    url: params.url,
    command: params.command,
    args: params.args,
    env: params.env,
    env_user_supplied: params.envUserSupplied,
    headers: params.headers,
    headers_user_supplied: params.headersUserSupplied,
    tools: params.tools,
    usage_examples: params.usageExamples,
    faqs: params.faqs,
    notes: params.notes,
  };
}
