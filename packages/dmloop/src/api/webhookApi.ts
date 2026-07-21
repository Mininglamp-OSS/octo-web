// @octo/loop — Webhook API（后端 /webhook-subscriptions，契约不变）
import type { WebhookSubscription, CreateWebhookReq, UpdateWebhookReq } from "./types";
import { httpGet, httpPost, httpPatch, httpDelete } from "./http";

// projectId 省略 = workspace 级：后端对无 project_id 过滤只返回 project_id IS NULL 的订阅。
export async function listWebhooks(projectId?: string): Promise<WebhookSubscription[]> {
  const data = await httpGet<{ subscriptions: WebhookSubscription[] }>(
    "/webhook-subscriptions",
    { project_id: projectId },
  );
  return data.subscriptions ?? [];
}

export function createWebhook(req: CreateWebhookReq): Promise<WebhookSubscription> {
  return httpPost<WebhookSubscription>("/webhook-subscriptions", req);
}

export function updateWebhook(id: string, req: UpdateWebhookReq): Promise<WebhookSubscription> {
  return httpPatch<WebhookSubscription>(`/webhook-subscriptions/${id}`, req);
}

export function deleteWebhook(id: string): Promise<void> {
  return httpDelete<void>(`/webhook-subscriptions/${id}`);
}
