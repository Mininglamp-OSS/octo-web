import { describe, expect, it } from "vitest";
import {
    buildIncomingWebhookUrl,
    buildWebhookUpsertReq,
    buildWebhookUrlRows,
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

    it("身份伪造防御：非 iwh_ 发送者即便 payload.from.kind=webhook 也不采信", () => {
        const from = webhookFromOfMessage({
            fromUID: "8e5efc4f",
            content: {
                contentObj: {
                    from: { kind: "webhook", name: "System Admin", avatar: "https://evil/a.png" },
                },
            },
        });
        expect(from).toBeUndefined();
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

describe("buildWebhookUpsertReq", () => {
    const existing = { name: "OldName", avatar: "https://old/a.png" };

    describe("新建态", () => {
        it("name 有值才发，并 trim", () => {
            expect(
                buildWebhookUpsertReq({ isEdit: false, isManager: false, name: "  CI  ", avatar: "" })
            ).toEqual({ name: "CI" });
        });

        it("name 留空 → 空对象（服务端自动命名），仍发请求", () => {
            expect(
                buildWebhookUpsertReq({ isEdit: false, isManager: false, name: "   ", avatar: "" })
            ).toEqual({});
        });

        it("普通成员即便填了 avatar 也不带（避免服务端 400）", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: false,
                    isManager: false,
                    name: "CI",
                    avatar: "https://x/y.png",
                })
            ).toEqual({ name: "CI" });
        });

        it("管理员 avatar 有值才带", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: false,
                    isManager: true,
                    name: "CI",
                    avatar: "https://x/y.png",
                })
            ).toEqual({ name: "CI", avatar: "https://x/y.png" });
            expect(
                buildWebhookUpsertReq({ isEdit: false, isManager: true, name: "CI", avatar: "  " })
            ).toEqual({ name: "CI" });
        });
    });

    describe("编辑态", () => {
        it("无任何变化 → 返回 null（不发请求）", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: true,
                    name: "OldName",
                    avatar: "https://old/a.png",
                    webhook: existing,
                })
            ).toBeNull();
        });

        it("成员只改名、不带 avatar", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: false,
                    name: "NewName",
                    avatar: "https://whatever/x.png",
                    webhook: existing,
                })
            ).toEqual({ name: "NewName" });
        });

        it("name 未变 + 非管理员 → req 空 → 返回 null", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: false,
                    name: "OldName",
                    avatar: "anything",
                    webhook: existing,
                })
            ).toBeNull();
        });

        it("管理员改 avatar（含清空）才发 avatar 字段", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: true,
                    name: "OldName",
                    avatar: "https://new/b.png",
                    webhook: existing,
                })
            ).toEqual({ avatar: "https://new/b.png" });
            // 清空头像也是一种变化
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: true,
                    name: "OldName",
                    avatar: "",
                    webhook: existing,
                })
            ).toEqual({ avatar: "" });
        });
    });
});

describe("buildWebhookUrlRows", () => {
    const apiURL = "/api/v1/";
    const origin = "https://host.example";
    const full = (rel: string) => `https://host.example/api/v1${rel}`;

    it("三个适配器 URL 齐全 → 三行，标签 key 正确", () => {
        const rows = buildWebhookUrlRows(
            {
                url: "/v1/incoming-webhooks/iwh_a/t",
                urls: {
                    native: "/v1/incoming-webhooks/iwh_a/t",
                    github: "/v1/incoming-webhooks/iwh_a/t/github",
                    wecom: "/v1/incoming-webhooks/iwh_a/t/wecom",
                },
            },
            apiURL,
            origin
        );
        expect(rows).toEqual([
            { key: "native", labelKey: "channelWebhook.url.native", url: full("/incoming-webhooks/iwh_a/t") },
            { key: "github", labelKey: "channelWebhook.url.github", url: full("/incoming-webhooks/iwh_a/t/github") },
            { key: "wecom", labelKey: "channelWebhook.url.wecom", url: full("/incoming-webhooks/iwh_a/t/wecom") },
        ]);
    });

    it("旧契约只给顶层 url（无 urls）→ native 回退到 url，github/wecom 过滤掉", () => {
        const rows = buildWebhookUrlRows(
            { url: "/v1/incoming-webhooks/iwh_a/t" },
            apiURL,
            origin
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            key: "native",
            labelKey: "channelWebhook.url.native",
            url: full("/incoming-webhooks/iwh_a/t"),
        });
    });

    it("urls 提供部分适配器 → 只出现非空的行", () => {
        const rows = buildWebhookUrlRows(
            {
                url: "/v1/incoming-webhooks/iwh_a/t",
                urls: { native: "/v1/incoming-webhooks/iwh_a/t", wecom: "/v1/incoming-webhooks/iwh_a/t/wecom" },
            },
            apiURL,
            origin
        );
        expect(rows.map((r) => r.key)).toEqual(["native", "wecom"]);
    });

    it("既无 url 也无 urls（退化态）→ 空数组", () => {
        expect(buildWebhookUrlRows({ url: "" }, apiURL, origin)).toEqual([]);
    });
});
