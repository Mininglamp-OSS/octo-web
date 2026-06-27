import { describe, expect, it } from "vitest";
import {
    IncomingWebhookStatus,
    MENTION_UIDS_MAX,
    buildIncomingWebhookUrl,
    buildWebhookAdapterExamples,
    buildWebhookCurlExample,
    buildWebhookUpsertReq,
    buildWebhookUrlRows,
    canManageIncomingWebhook,
    canTestWebhook,
    isFlagOn,
    isIncomingWebhookSender,
    normalizeMentionUids,
    toShortWebhookAlias,
    validateMentionUids,
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

describe("toShortWebhookAlias (#452)", () => {
    it("canonical 相对路径 → 短别名，webhook_id/token 保留", () => {
        expect(toShortWebhookAlias("/v1/incoming-webhooks/iwh_a/tok")).toBe(
            "/v1/webhooks/iwh_a/tok"
        );
    });

    it("适配器后缀完整保留", () => {
        expect(toShortWebhookAlias("/v1/incoming-webhooks/iwh_a/tok/github")).toBe(
            "/v1/webhooks/iwh_a/tok/github"
        );
    });

    it("query 串完整保留", () => {
        expect(toShortWebhookAlias("/v1/incoming-webhooks/iwh_a/tok?foo=bar")).toBe(
            "/v1/webhooks/iwh_a/tok?foo=bar"
        );
    });

    it("绝对地址里的 canonical 段也被改写（仅换一次）", () => {
        expect(
            toShortWebhookAlias("https://h.e/api/v1/incoming-webhooks/iwh_a/tok")
        ).toBe("https://h.e/api/v1/webhooks/iwh_a/tok");
    });

    it("幂等：已是短别名 → 原样返回（前向兼容后端将来直接返回别名）", () => {
        const short = "/v1/webhooks/iwh_a/tok";
        expect(toShortWebhookAlias(short)).toBe(short);
    });

    it("不含 canonical 段 → 原样返回", () => {
        expect(toShortWebhookAlias("/v1/message/send")).toBe("/v1/message/send");
    });

    it("不误伤管理面 /v1/groups/{group_no}/incoming-webhooks（前缀不同）", () => {
        const mgmt = "/v1/groups/g_1/incoming-webhooks";
        expect(toShortWebhookAlias(mgmt)).toBe(mgmt);
    });

    it("空串 → 空串", () => {
        expect(toShortWebhookAlias("")).toBe("");
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

    describe("mention_uids (#465)", () => {
        it("新建态：非空才发，并去重 + trim", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: false,
                    isManager: false,
                    name: "CI",
                    avatar: "",
                    mentionUids: [" uid_a ", "uid_b", "uid_a", "  "],
                })
            ).toEqual({ name: "CI", mention_uids: ["uid_a", "uid_b"] });
        });

        it("新建态：空选择不带 mention_uids 字段", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: false,
                    isManager: false,
                    name: "CI",
                    avatar: "",
                    mentionUids: [],
                })
            ).toEqual({ name: "CI" });
        });

        it("编辑态：集合无变化（仅顺序/重复不同）→ 不发", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: true,
                    name: "OldName",
                    avatar: "https://old/a.png",
                    mentionUids: ["uid_b", "uid_a", "uid_a"],
                    webhook: { ...existing, mention_uids: ["uid_a", "uid_b"] },
                })
            ).toBeNull();
        });

        it("编辑态：新增成员 → 发完整新集合", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: true,
                    name: "OldName",
                    avatar: "https://old/a.png",
                    mentionUids: ["uid_a", "uid_b"],
                    webhook: { ...existing, mention_uids: ["uid_a"] },
                })
            ).toEqual({ mention_uids: ["uid_a", "uid_b"] });
        });

        it("编辑态：清空（[]）是显式变化 → 发空数组", () => {
            expect(
                buildWebhookUpsertReq({
                    isEdit: true,
                    isManager: true,
                    name: "OldName",
                    avatar: "https://old/a.png",
                    mentionUids: [],
                    webhook: { ...existing, mention_uids: ["uid_a"] },
                })
            ).toEqual({ mention_uids: [] });
        });
    });
});

describe("normalizeMentionUids / validateMentionUids", () => {
    it("normalize：trim、丢空、按首次出现去重", () => {
        expect(normalizeMentionUids([" a ", "b", "a", "", "  ", "b"])).toEqual([
            "a",
            "b",
        ]);
    });

    it("validate：合法集合返回去重后的 uids", () => {
        const r = validateMentionUids(["a", "a", "b"]);
        expect(r).toEqual({ ok: true, uids: ["a", "b"] });
    });

    it("validate：超过上限 → tooMany", () => {
        const tooMany = Array.from({ length: MENTION_UIDS_MAX + 1 }, (_, i) => `u${i}`);
        expect(validateMentionUids(tooMany)).toEqual({ ok: false, reason: "tooMany" });
    });

    it("validate：刚好上限 → ok", () => {
        const exact = Array.from({ length: MENTION_UIDS_MAX }, (_, i) => `u${i}`);
        const r = validateMentionUids(exact);
        expect(r.ok).toBe(true);
    });

    it("validate：单 uid 超长（>40）→ tooLong", () => {
        expect(validateMentionUids(["x".repeat(41)])).toEqual({
            ok: false,
            reason: "tooLong",
        });
    });
});

describe("buildWebhookUrlRows", () => {
    const apiURL = "/api/v1/";
    const origin = "https://host.example";
    const full = (rel: string) => `https://host.example/api/v1${rel}`;

    // 后端返回的仍是 canonical /v1/incoming-webhooks/...（#456 保持向后兼容），
    // 展示层统一改写成更短的等价别名 /v1/webhooks/...（#452）。
    it("三个适配器 URL 齐全 → 三行，标签 key 正确，展示为短别名（#452）", () => {
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
            { key: "native", labelKey: "channelWebhook.url.native", url: full("/webhooks/iwh_a/t") },
            { key: "github", labelKey: "channelWebhook.url.github", url: full("/webhooks/iwh_a/t/github") },
            { key: "wecom", labelKey: "channelWebhook.url.wecom", url: full("/webhooks/iwh_a/t/wecom") },
        ]);
    });

    it("旧契约只给顶层 url（无 urls）→ native 回退到 url 并改写为短别名，github/wecom 过滤掉", () => {
        const rows = buildWebhookUrlRows(
            { url: "/v1/incoming-webhooks/iwh_a/t" },
            apiURL,
            origin
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            key: "native",
            labelKey: "channelWebhook.url.native",
            url: full("/webhooks/iwh_a/t"),
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

describe("buildWebhookAdapterExamples (#475)", () => {
    const apiURL = "/api/v1/";
    const origin = "https://host.example";
    const full = (rel: string) => `https://host.example/api/v1${rel}`;

    const example = (over: Record<string, unknown> = {}) => ({
        key: "github",
        title: "GitHub 事件",
        description: "把 Payload URL 登记到仓库 Webhook 设置。",
        url: "/v1/incoming-webhooks/iwh_a/t/github",
        content_type: "application/json",
        auth: { type: "url_token" },
        steps: ["进入仓库 → Settings → Webhooks", "填入 Payload URL", "保存"],
        ...over,
    });

    it("缺失 adapter_examples（老后端）→ 空数组（调用方据此走兜底）", () => {
        expect(buildWebhookAdapterExamples({}, apiURL, origin)).toEqual([]);
        expect(buildWebhookAdapterExamples({ adapter_examples: [] }, apiURL, origin)).toEqual([]);
    });

    it("相对 url 经短别名改写 + base 拼接，文案/steps 原样透传", () => {
        const rows = buildWebhookAdapterExamples(
            { adapter_examples: [example()] as never },
            apiURL,
            origin
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            key: "github",
            title: "GitHub 事件",
            description: "把 Payload URL 登记到仓库 Webhook 设置。",
            url: full("/webhooks/iwh_a/t/github"),
            contentType: "application/json",
            auth: { type: "url_token" },
            steps: ["进入仓库 → Settings → Webhooks", "填入 Payload URL", "保存"],
        });
    });

    it("保留服务端给的 GitLab header 鉴权信息（前端不写死 header 名）", () => {
        const rows = buildWebhookAdapterExamples(
            {
                adapter_examples: [
                    example({
                        key: "gitlab",
                        url: "/v1/incoming-webhooks/iwh_a/t/gitlab",
                        auth: {
                            type: "url_token_and_header",
                            header: "X-Gitlab-Token",
                            value_source: "token",
                        },
                    }),
                ] as never,
            },
            apiURL,
            origin
        );
        expect(rows[0].auth).toEqual({
            type: "url_token_and_header",
            header: "X-Gitlab-Token",
            value_source: "token",
        });
        expect(rows[0].url).toBe(full("/webhooks/iwh_a/t/gitlab"));
    });

    it("未知 key 不被过滤（后端新增适配器无需前端发版）", () => {
        const rows = buildWebhookAdapterExamples(
            {
                adapter_examples: [
                    example({ key: "slack", url: "/v1/incoming-webhooks/iwh_a/t/slack" }),
                ] as never,
            },
            apiURL,
            origin
        );
        expect(rows.map((r) => r.key)).toEqual(["slack"]);
    });

    it("丢弃无 key / 无 url 的脏条目，steps 丢空行，文案 trim", () => {
        const rows = buildWebhookAdapterExamples(
            {
                adapter_examples: [
                    example({ key: "" }),
                    example({ url: "" }),
                    example({
                        title: "  GitHub  ",
                        steps: ["  a  ", "", "  b  "],
                    }),
                ] as never,
            },
            apiURL,
            origin
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe("GitHub");
        expect(rows[0].steps).toEqual(["a", "b"]);
    });

    it("非字符串字段（数字/对象）不抛错，按缺省降级而非崩溃", () => {
        // 弹窗 render 时调用，脏数据若让 .trim() / toShortWebhookAlias 抛错，
        // 一次性 token 弹窗会整体崩掉、token 取不回——这里钉死「降级不抛错」。
        const run = () =>
            buildWebhookAdapterExamples(
                {
                    adapter_examples: [
                        // url 为数字：不得在 toShortWebhookAlias 上抛错；无可用 url → 被过滤。
                        example({ key: "bad-url", url: 123 }),
                        // title/description/steps 含非字符串：trim 不得抛错，非串项按空处理。
                        example({
                            key: "github",
                            title: 42,
                            description: { html: "x" },
                            steps: ["  ok  ", 7, null, "  done  "],
                            auth: "not-an-object",
                        }),
                    ] as never,
                },
                apiURL,
                origin
            );
        expect(run).not.toThrow();
        const rows = run();
        expect(rows.map((r) => r.key)).toEqual(["github"]);
        expect(rows[0].title).toBe("");
        expect(rows[0].description).toBe("");
        expect(rows[0].steps).toEqual(["ok", "done"]);
        expect(rows[0].auth).toEqual({ type: "" });
    });
});

describe("buildWebhookCurlExample", () => {
    const url = "https://im-test.example.com/api/v1/incoming-webhooks/iwh_abc/tok";
    const sample = "构建成功 ✅";

    it("native：body 用 content，不含 msgtype", () => {
        const out = buildWebhookCurlExample("native", url, sample);
        expect(out).toContain(`curl -X POST '${url}'`);
        expect(out).toContain("-H 'Content-Type: application/json'");
        // native 直接 content；解析 -d 实参核对结构，避免转义/字段名漂移。
        const body = JSON.parse(out.match(/-d '(.+)'$/)![1]);
        expect(body).toEqual({ content: sample });
        expect(out).not.toContain("msgtype");
    });

    it("wecom：body 用企微 msgtype/text 结构", () => {
        const out = buildWebhookCurlExample("wecom", url, sample);
        const body = JSON.parse(out.match(/-d '(.+)'$/)![1]);
        expect(body).toEqual({ msgtype: "text", text: { content: sample } });
    });

    it("刻意不带 username / avatar_url（管理员专属覆盖字段，默认带上会误导）", () => {
        expect(buildWebhookCurlExample("native", url, sample)).not.toMatch(
            /username|avatar_url/
        );
        expect(buildWebhookCurlExample("wecom", url, sample)).not.toMatch(
            /username|avatar_url/
        );
    });

    it("样例文案含单引号时做 POSIX 转义，复制出的命令仍可执行", () => {
        const out = buildWebhookCurlExample("native", url, "C'est fait ✅");
        // 转义后 -d 实参形如 '...'\''...'：不应出现未转义的裸 ' 提前终止引号串。
        expect(out).toContain("'\\''");
        // 仍是合法的单引号包裹串：去掉 '\'' 续接记法后，content 应原样还原。
        const dArg = out.match(/-d '(.*)'$/s)![1];
        const unquoted = dArg.replace(/'\\''/g, "'");
        expect(JSON.parse(unquoted)).toEqual({ content: "C'est fait ✅" });
    });

    it("URL 含单引号时同样转义，不会破坏 curl 目标", () => {
        const out = buildWebhookCurlExample("native", "https://h/x'y", sample);
        expect(out).toContain("curl -X POST 'https://h/x'\\''y'");
    });
});

describe("canTestWebhook", () => {
    it("仅 enabled 可测试，disabled / deleted 一律拒绝", () => {
        expect(canTestWebhook({ status: IncomingWebhookStatus.enabled })).toBe(true);
        expect(canTestWebhook({ status: IncomingWebhookStatus.disabled })).toBe(false);
        expect(canTestWebhook({ status: IncomingWebhookStatus.deleted })).toBe(false);
    });
});

describe("isFlagOn", () => {
    it("归一化后端 0/1 能力位的各种序列化形态", () => {
        // 真值形态（数字 / 布尔 / 字符串，覆盖后端序列化漂移）
        expect(isFlagOn(1)).toBe(true);
        expect(isFlagOn(true)).toBe(true);
        expect(isFlagOn("1")).toBe(true);
        expect(isFlagOn("true")).toBe(true);
        // 假值 / 缺省
        expect(isFlagOn(0)).toBe(false);
        expect(isFlagOn(false)).toBe(false);
        expect(isFlagOn("0")).toBe(false);
        expect(isFlagOn(undefined)).toBe(false);
        expect(isFlagOn(null)).toBe(false);
    });
});
