import { describe, expect, it } from "vitest";
import {
    buildIncomingWebhookUrl,
    canManageIncomingWebhook,
    isIncomingWebhookSender,
    webhookFromOfMessage,
} from "../IncomingWebhook";

describe("buildIncomingWebhookUrl", () => {
    const rel = "/v1/incoming-webhooks/iwh_abc/token123";

    it("生产形态：apiURL=/api/v1/ 时剥掉重复的 /v1 段", () => {
        expect(buildIncomingWebhookUrl(rel, "/api/v1/", "https://host.example")).toBe(
            "https://host.example/api/v1/incoming-webhooks/iwh_abc/token123"
        );
    });

    it("apiURL 为绝对地址时以其 origin 为准", () => {
        expect(
            buildIncomingWebhookUrl(rel, "https://api.example.com/api/v1/", "https://web.example")
        ).toBe("https://api.example.com/api/v1/incoming-webhooks/iwh_abc/token123");
    });

    it("apiURL 不带版本段时直接拼接", () => {
        expect(buildIncomingWebhookUrl(rel, "/api/", "https://host.example")).toBe(
            "https://host.example/api/v1/incoming-webhooks/iwh_abc/token123"
        );
    });

    it("apiURL 为空时退化为 origin + 相对路径", () => {
        expect(buildIncomingWebhookUrl(rel, "", "https://host.example")).toBe(
            "https://host.example/v1/incoming-webhooks/iwh_abc/token123"
        );
    });

    it("相对路径缺少前导斜杠时补齐", () => {
        expect(
            buildIncomingWebhookUrl("v1/incoming-webhooks/iwh_a/t", "/api/v1/", "https://h.e")
        ).toBe("https://h.e/api/v1/incoming-webhooks/iwh_a/t");
    });

    it("服务端未来直接返回绝对地址时原样透传", () => {
        const abs = "https://other.example/v1/incoming-webhooks/iwh_a/t";
        expect(buildIncomingWebhookUrl(abs, "/api/v1/", "https://h.e")).toBe(abs);
    });

    it("空路径返回空串", () => {
        expect(buildIncomingWebhookUrl("", "/api/v1/", "https://h.e")).toBe("");
    });

    it("github / wecom 适配器后缀完整保留", () => {
        expect(buildIncomingWebhookUrl(`${rel}/github`, "/api/v1/", "https://h.e")).toBe(
            "https://h.e/api/v1/incoming-webhooks/iwh_abc/token123/github"
        );
        expect(buildIncomingWebhookUrl(`${rel}/wecom`, "/api/v1/", "https://h.e")).toBe(
            "https://h.e/api/v1/incoming-webhooks/iwh_abc/token123/wecom"
        );
    });
});

describe("isIncomingWebhookSender", () => {
    it("识别 iwh_ 前缀", () => {
        expect(isIncomingWebhookSender("iwh_becd9cdbeda34190")).toBe(true);
        expect(isIncomingWebhookSender("8e5efc4fbc884d36")).toBe(false);
        expect(isIncomingWebhookSender("")).toBe(false);
        expect(isIncomingWebhookSender(undefined)).toBe(false);
    });
});

describe("webhookFromOfMessage", () => {
    it("payload.from.kind=webhook 时返回完整身份", () => {
        const from = webhookFromOfMessage({
            fromUID: "iwh_abc",
            content: {
                contentObj: {
                    from: { kind: "webhook", webhook_id: "iwh_abc", name: "CI Bot", avatar: "https://a/b.png" },
                },
            },
        });
        expect(from).toEqual({
            kind: "webhook",
            webhook_id: "iwh_abc",
            name: "CI Bot",
            avatar: "https://a/b.png",
        });
    });

    it("payload.from 缺失但 uid 为 iwh_ 前缀时按前缀兜底识别", () => {
        const from = webhookFromOfMessage({ fromUID: "iwh_abc", content: { contentObj: {} } });
        expect(from).toEqual({ kind: "webhook" });
    });

    it("payload.from.kind 非 webhook（如普通用户消息）不误判", () => {
        const from = webhookFromOfMessage({
            fromUID: "8e5efc4f",
            content: { contentObj: { from: { kind: "user", name: "x" } } },
        });
        expect(from).toBeUndefined();
    });

    it("普通消息（无 payload.from、非 iwh_ uid）返回 undefined", () => {
        expect(webhookFromOfMessage({ fromUID: "8e5efc4f", content: { contentObj: {} } })).toBeUndefined();
        expect(webhookFromOfMessage({ fromUID: "8e5efc4f" })).toBeUndefined();
    });
});

describe("canManageIncomingWebhook", () => {
    const item = { creator_uid: "uid_a" };

    it("管理员可管理任意 webhook", () => {
        expect(canManageIncomingWebhook(item, { isManager: true, myUid: "uid_b" })).toBe(true);
    });

    it("普通成员仅能管理自己创建的", () => {
        expect(canManageIncomingWebhook(item, { isManager: false, myUid: "uid_a" })).toBe(true);
        expect(canManageIncomingWebhook(item, { isManager: false, myUid: "uid_b" })).toBe(false);
    });

    it("未登录态（myUid 缺失）不可管理", () => {
        expect(canManageIncomingWebhook(item, { isManager: false })).toBe(false);
        expect(canManageIncomingWebhook(item, { isManager: false, myUid: "" })).toBe(false);
    });
});
