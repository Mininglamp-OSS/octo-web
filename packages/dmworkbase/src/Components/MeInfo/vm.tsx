import React from "react";
import QRCodeMy from "../QRCodeMy";
import WKApp from "../../App";
import RouteContext, { FinishButtonContext, RouteContextConfig } from "../../Service/Context";
import { ProviderListener } from "../../Service/Provider";
import { Row, Section } from "../../Service/Section";
import { InputEdit } from "../InputEdit";
import { ListItem, ListItemIcon } from "../ListItem";
import { Sex, SexSelect } from "../SexSelect";
import { ListItemAvatar } from "../ListItemAvatar";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import axios from "axios";
import { Toast } from "@douyinfe/semi-ui";
import WKSDK, { Channel } from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
import { ChannelInfo, ChannelTypePerson } from "wukongimjssdk";
import { Convert } from "../../Service/Convert";
import { isRealnameVerified } from "../../Utils/displayName";
import { resolveRealnameVerifyUrl } from "./realnameVerifyUrl";
import PersonaSettings from "../PersonaSettings";

/**
 * MeInfoVM — 自己的「个人信息 / 设置」页面 ViewModel
 *
 * GH #1121 接入实名认证。
 * Phase 2a：「去认证」入口改为直跳 IdP 账户页, 不再调用
 *   verify-service 翻译接口。
 * GH #1174：IdP 域名改为按环境从后端 appconfig 下发的
 *   `oidc_providers[].account_url` 字段读, 而非硬编码 prod URL。
 *   im-test 会拿到 `accounts-test.imocto.cn`, im-prod 拿到 `accounts.xming.ai`,
 *   和 NavSettingsPanel 「账户中心」入口口径一致。
 *
 * GH #1180（Phase 2e 闭环）:im-test 实机发现原方案有 2 个闭环 bug,
 *   本 VM 的职责是把前端部分修好:
 *     1. startRealnameVerify 必须传 return_to = `${origin}${pathname}?verified=1`,
 *        否则用户在 IdP 完成实名没法回跳
 *     2. 删 window.open 失败降级为 `window.location.href=verifyUrl` 的 fallback ——
 *        双跳转是 P1 UX bug,用户点"去认证"会一边开新 tab 一边把当前 tab 替换掉,
 *        导致 ?verified=1 的回跳 handler 永远没有"原页面"可触发
 *
 * dmworkim 的 `POST /v1/internal/realname/pull-from-idp` endpoint 已废弃
 *   (IdP 不支持对应的 admin API)。实名同步改走 dmworkim 后端 sync_worker 每 15min
 *   自动通过 /userinfo 同步, 前端不再主动 pull。本 VM 从 didMount / 回跳 handler 里
 *   删掉了 pull-from-idp POST, 仅保留 reloadSelfProfile() 作为刷新实名状态的唯一路径。
 *   ?verified=1 回跳后徽章可能最多有 15min 感知延迟(下次 sync_worker tick), 对大多数
 *   用户可接受 —— 实名动作本身人无需秒级反馈。
 *
 *   - 「名字」行右侧展示 ✓ + 「已实名」tag（已认证）
 *   - 新增「账号安全 · 实名认证」section
 *     · 已认证：展示 「已认证 · {年-月}」不可点
 *     · 未认证：展示「去认证」CTA，点击 `window.open(<account_url>/profile/info?anchor=verification&return_to=…, '_blank')`
 *       新窗打开 IdP 账户页实名锚点。
 *   - IdP 完成认证后会以 `return_to` 带 `?verified=1` 回跳，由本 VM 的
 *     didMount 兜底 handler + 全局 useRealnameVerifiedLandingHandler 捕获，
 *     重新 `reloadSelfProfile()` 同步新状态(依赖 sync_worker 已写入 user_verification)。
 *   - 老版本后端兜底仍保留：dmworkim /v1/internal/verify-token 现在返回的
 *     也是按环境下发的 IdP URL，老 App 客户端无需改动即可工作。
 */
export class MeInfoVM extends ProviderListener {

    channelInfoListener!:ChannelInfoListener
    /** 本页加载时主动拉取的自身 profile（含 realname_verified / real_name） */
    selfChannelInfo?: ChannelInfo

    didMount(): void {
        this.channelInfoListener = (channelInfo:ChannelInfo)=>{
            if(channelInfo.channel.channelType !== ChannelTypePerson) {
                return
            }
            if(channelInfo.channel.channelID !== WKApp.loginInfo.uid) {
                return
            }
            WKApp.loginInfo.name = channelInfo.title;
            WKApp.loginInfo.shortNo = channelInfo.orgData.short_no;
            WKApp.loginInfo.sex = channelInfo.orgData.sex;
            this.syncRealnameFromOrgData(channelInfo.orgData)
            WKApp.shared.myUserAvatarChange()
            this.selfChannelInfo = channelInfo
            this.notifyListener()
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

        // pull-from-idp endpoint 已废弃(dmworkim 侧),本页打开时仅做两件事:
        //   1. 同步清掉 ?verified=1 query(回跳兜底,避免二次进入重复触发)
        //   2. reloadSelfProfile 拉一次最新 /users/{uid}
        //
        // 实名状态由 dmworkim sync_worker 每 15min 自动从 IdP /userinfo 同步到
        // user_verification cache。?verified=1 回跳时徽章不保证秒亮,最多 15min 后
        // 下一轮 sync_worker tick 同步到; 用户已登录过(OIDC callback 即时 upsert)
        // 且 sync_worker 已跑过一轮的常态下, 通常 reloadSelfProfile 已能读到最新状态。
        try {
            const params = new URLSearchParams(window.location.search)
            if (params.get("verified") === "1") {
                params.delete("verified")
                const rest = params.toString()
                const url = window.location.pathname + (rest ? ("?" + rest) : "") + window.location.hash
                window.history.replaceState(null, "", url)
            }
        } catch (e) {
            // URL API 在非浏览器环境下可能不可用 — 静默降级，不阻塞页面
        }

        // reloadSelfProfile 内部已 catch 所有 API 错误,不会升成 unhandled rejection。
        void this.reloadSelfProfile()
    }

    didUnMount(): void {
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }

    /**
     * 把 profile orgData 里的实名字段回写到 WKApp.loginInfo（方便跨页面快速判定）。
     * 硬约束：仅处理 realname_verified / real_name 两个字段，不扩散其他字段到 loginInfo。
     */
    private syncRealnameFromOrgData(orgData: any) {
        const verified = isRealnameVerified(orgData)
        WKApp.loginInfo.realnameVerified = verified
        if (verified && typeof orgData?.real_name === "string" && orgData.real_name.length > 0) {
            WKApp.loginInfo.realName = orgData.real_name
        } else {
            WKApp.loginInfo.realName = undefined
        }
        const verifiedAt = orgData?.realname_verified_at
        if (typeof verifiedAt === "number" && verifiedAt > 0) {
            WKApp.loginInfo.realnameVerifiedAt = verifiedAt
        }
        WKApp.loginInfo.save()
    }

    async reloadSelfProfile() {
        const uid = WKApp.loginInfo.uid
        if (!uid) return
        try {
            const res = await WKApp.apiClient.get<any>(`users/${uid}`)
            const channelInfo = Convert.userToChannelInfo(res)
            this.selfChannelInfo = channelInfo
            this.syncRealnameFromOrgData(channelInfo.orgData)
            this.notifyListener()
        } catch (e: any) {
            // 个人页拉取失败不打断渲染（仍然有 loginInfo 的缓存字段），仅静默
            // 控制台打印以便排查
            // eslint-disable-next-line no-console
            console.warn("[MeInfoVM] reloadSelfProfile failed", e)
        }
    }

    /**
     * Phase 2a：「去认证」入口直跳 IdP 账户页。
     * GH #1174：IdP 域名改为按环境从后端 appconfig 下发的
     *   `oidc_providers[].account_url` 读, 不再硬编码 prod URL。
     * GH #1180（Phase 2e 闭环）:
     *   1. URL 必须带 `return_to=${encodeURIComponent(${origin}${pathname}?verified=1)}`,
     *      否则用户在 IdP 完成实名后回不到 OCTO,整个链路断在 IdP
     *   2. 删除 `window.open` 失败降级为 `window.location.href=verifyUrl` 的 fallback——
     *      那是 P1 双跳转 bug:原页面会被替换,等 IdP 302 回来时没有"原 MeInfo
     *      页面"可触发 ?verified=1 handler;改为 toast 提示用户允许弹窗
     *      (禁忌:`window.open fallback 不能改为 tab 跳 + 再 reload,依然会丢状态`)
     *
     * 不再调用 dmworkim `/v1/internal/verify-token` 翻译接口 —— Web 端直接
     * `window.open` 到 IdP 的实名认证锚点。IdP 完成后会 redirect 回
     * 本页（带 ?verified=1），由 didMount 的兜底 handler + 全局
     * useRealnameVerifiedLandingHandler 触发 reloadSelfProfile 同步状态
     * (pull-from-idp 已废弃, 实名同步改走 dmworkim sync_worker 15min 轮询)。
     *
     * URL 解析口径（resolveRealnameVerifyUrl）：
     *   - 按 loginInfo.loginProvider 在 remoteConfig.oidcProviders 里查
     *     对应 provider 的 accountUrl, 拼 `${accountUrl}/profile/info?anchor=verification&return_to=…`。
     *     与 NavSettingsPanel「账户中心」入口口径一致（accounts-test.imocto.cn
     *     on im-test / accounts.xming.ai on im-prod, 后端下发）。
     *   - loginProvider=local / 空 / provider 无 account_url / provider 不在
     *     下发列表里 → Toast 明示, 不跳转。严禁回退到任何硬编码 prod 域。
     *
     * 弹窗被浏览器拦截:不再自动切当前 tab(那是 P1 bug 的源头,会丢 session
     * 和 ?verified=1 回跳上下文), 改成 toast 提示用户允许弹窗。用户允许后再次点击即可。
     *
     * 老 App 兜底：dmworkim 的 verify-token 接口仍然保留，只是现在返回
     * 按环境下发的 IdP URL，老版本客户端无需改动。
     */
    startRealnameVerify() {
        // Round 1 修正(Jerry-Xin Crit):return_to 必须**保留当前 URL 的全部
        // query 参数**(尤其 sid),否则 IdP 302 回来时 sid 丢失 → App.tsx::getSID 读
        // 空 sid bucket → loginInfo 读不到 token → 后续 /users/{uid} 刷新拿不到鉴权。
        //
        // 登录态按 sid 分桶(App.tsx:275 / 291 / Route.tsx:45 均按 sid 读写 storage key)。
        // 不能用 `${origin}${pathname}?verified=1` 了 —— 必须把现有 ?sid=xxx&... 完整保留,
        // 再 append/overwrite verified=1。
        //
        // 行为:
        //   - 原 URL `/me?sid=abc` → returnTo `/me?sid=abc&verified=1`(同时保留 sid + 新增 verified)
        //   - 原 URL `/me`(无 query)→ returnTo `/me?verified=1`
        //   - 原 URL `/me?verified=0` → returnTo `/me?verified=1`(URLSearchParams.set 覆盖旧值)
        //   - hash 不带入 —— IdP 对超长 return_to / 含 fragment 的 URL 可能校验失败
        const returnToParams = new URLSearchParams(window.location.search)
        returnToParams.set("verified", "1")
        const returnToQuery = returnToParams.toString()
        const returnTo = `${window.location.origin}${window.location.pathname}${returnToQuery ? "?" + returnToQuery : ""}`

        // 读按环境下发的 account_url —— 防止把 im-test 用户甩到 prod IdP。
        // 具体行为合约见 resolveRealnameVerifyUrl 的 JSDoc 和 __tests__/realnameVerifyUrl.test.ts。
        const resolved = resolveRealnameVerifyUrl(
            WKApp.loginInfo.loginProvider,
            WKApp.remoteConfig.oidcProviders,
            returnTo,
        )
        if (!resolved.ok) {
            switch (resolved.reason) {
                case "no_login_provider":
                    // 理论上到这里时用户已经登录；空 provider 一般是 SID 存储格式历史遗留,
                    // 展示同 local 的提示即可,引导用户联系管理员。
                case "local_account":
                    Toast.error("当前账号不支持在线实名认证，请联系管理员")
                    break
                case "no_account_url":
                    // appconfig 没下发对应 provider 的 account_url：要么配置漏了,
                    // 要么用户登录用的 provider 已被后端下掉。兜底 Toast, 不跳 prod。
                    Toast.error("当前环境未配置实名认证入口，请稍后再试或联系管理员")
                    break
            }
            return
        }
        const verifyUrl = resolved.url
        // 新 tab 打开,必须能区分「真被浏览器拦截」vs「成功打开」。
        //
        // Jerry R3 blocking:
        //   之前写法 `window.open(url, "_blank", "noopener,noreferrer")` 有致命坑 ——
        //   MDN 明确说明 `noopener` feature 会让 window.open 返回 null(新窗口没有
        //   opener 引用),这意味着**成功打开的 case 也会返回 null**,原 `if (!opened)`
        //   判断把正常打开误判成弹窗被拦截,用户白看一次 toast。
        //
        // 正确做法:先 open("about:blank") 拿窗口引用,再手动解除 opener + 导航:
        //   - 真被拦截 → window.open 返 null → 正确 toast
        //   - 成功打开 → 拿到窗口引用 → opener=null 等价 noopener 安全隔离 →
        //     location.href 再跳目标 URL,IdP 无法通过 window.opener 反操作本页。
        //
        // 绝不再降级为 `window.location.href = verifyUrl` —— 双跳 + 丢状态是 P1 bug 根因。
        const opened = window.open("about:blank", "_blank")
        if (!opened) {
            // 弹窗被浏览器拦截:提示用户允许弹窗后重试,不自动替换当前 tab。
            // 即使用户不允许,当前 tab 的 MeInfo 状态保留,避免 "?verified=1 handler
            // 无法触发" 的二次事故。
            Toast.warning("浏览器拦截了新窗口，请允许本站弹窗后重试「去认证」")
            return
        }
        // 手动解除 opener,等价 noopener 安全隔离(防 IdP 通过 window.opener 反操作本页)。
        try {
            opened.opener = null
        } catch {
            // 极少数浏览器/沙箱下 opener setter 可能被冻结;继续导航,
            // about:blank 同源策略已把残留风险收敛到可接受范围。
        }
        opened.location.href = verifyUrl
    }

    uploadAvatar(file: File) {
        const param = new FormData();
        param.append("file", file);
        return axios.post(`users/${WKApp.loginInfo.uid}/avatar`, param, {
            headers: { "Content-Type": "multipart/form-data", "token": WKApp.loginInfo.token || "" },
        }).catch(error => {
        })
    }

    updateMyInfo(field: string, value: string) {
        let param: any = {}
        param[field] = value
        return WKApp.apiClient.put("user/current", param).catch((err) => {
            Toast.error(err.msg)
        })
    }

    inputEditPush(context: RouteContext<any>, defaultValue: string, onFinish: (value: string) => Promise<void>, placeholder?: string,maxCount?:number) {
        let value: string
        let finishButtonContext: FinishButtonContext
        context.push(<InputEdit maxCount={maxCount} defaultValue={defaultValue} placeholder={placeholder} onChange={(v) => {
            value = v
            if (!value || value === "") {
                finishButtonContext.disable(true)
            } else {
                finishButtonContext.disable(false)
            }
        }}></InputEdit>, new RouteContextConfig({
            showFinishButton: true,
            onFinishContext: (finishBtnContext) => {
                finishButtonContext = finishBtnContext
                finishBtnContext.disable(true)
            },
            onFinish: async () => {
                finishButtonContext.loading(true)
                await onFinish(value)
                finishButtonContext.loading(false)

                context.pop()
            }
        }))
    }

    /**
     * 「名字」行的 subTitle — 已认证时展示 「real_name ✓ 已实名」，
     * 未认证时退化为普通昵称字符串。
     * 已实名时的 displayName 走 `loginInfo.selfDisplayName()`，和
     * 气泡 / QRCode / 好友申请文案同一处结算，规则改动全局一致。
     */
    private nameRowSubTitle(): React.ReactNode {
        if (WKApp.loginInfo.realnameVerified !== true) {
            return WKApp.loginInfo.name || ""
        }
        return (
            <span style={{ display: "inline-flex", alignItems: "center" }}>
                {WKApp.loginInfo.selfDisplayName()}
                <RealnameVerifiedBadge />
            </span>
        )
    }

    /**
     * 格式化「已认证 · 2025-03」展示文本。
     * verified_at 字段后端若缺失，只展示「已认证」不拼年月，避免显示 NaN。
     */
    private formatVerifiedAtLabel(): string {
        const ts = WKApp.loginInfo.realnameVerifiedAt
        if (!ts || typeof ts !== "number" || ts <= 0) {
            return "已认证"
        }
        // 后端通常发秒级时间戳，兼容毫秒
        const ms = ts > 10_000_000_000 ? ts : ts * 1000
        const d = new Date(ms)
        if (Number.isNaN(d.getTime())) {
            return "已认证"
        }
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, "0")
        return `已认证 · ${yyyy}-${mm}`
    }

    sections(context: RouteContext<any>) {

        let sections = new Array<Section>()
        sections.push(new Section({
            rows: [
                new Row({
                    cell: ListItemAvatar,
                    properties: {
                        title: `头像`,
                        context: context,
                        avatar: <img style={{ "width": "24px", "height": "24px", "borderRadius": "50%" }} src={WKApp.shared.avatarUser(WKApp.loginInfo.uid || "")}></img>,
                        onFileUpload: async (f: File) => {
                            await this.uploadAvatar(f)
                            WKApp.shared.changeChannelAvatarTag(new Channel(WKApp.loginInfo.uid||"", ChannelTypePerson))
                        }
                    }
                }),
                new Row({
                    cell: ListItem,
                    properties: {
                        title: "名字",
                        subTitle: this.nameRowSubTitle(),
                        onClick: () => {
                            this.inputEditPush(context, WKApp.loginInfo.name || "", async (value) => {
                                if (value.trim() === "") {
                                    Toast.error("名字不能为空！")
                                    return
                                }
                                return this.updateMyInfo("name",value).then(()=>{
                                    WKApp.loginInfo.name = value
                                    WKApp.loginInfo.save()
                                })
                            }, "设置名字",20)
                        }
                    }
                }),
                new Row({
                    cell: ListItem,
                    properties: {
                        title: `${WKApp.config.appName}号`,
                        subTitle: WKApp.loginInfo.shortNo,
                        onClick: () => {

                        }
                    }
                }),
                new Row({
                    cell: ListItemIcon,
                    properties: {
                        title: `我的二维码`,
                        icon: <img style={{ "width": "24px", "height": "24px" }} src={require("./../../assets/icon_qrcode.png")}></img>,
                        onClick: () => {
                            context.push(<QRCodeMy disableHeader={true}></QRCodeMy>)
                        }
                    }
                })
            ]
        }))

        let sex = WKApp.loginInfo.sex === 0 ? Sex.Female : Sex.Male
        let sexStr = "男"
        if (sex === Sex.Female) {
            sexStr = "女"
        }

        sections.push(new Section({
            rows: [
                new Row({
                    cell: ListItem,
                    properties: {
                        title: "性别",
                        subTitle: sexStr,
                        onClick: () => {
                            context.push(<SexSelect sex={sex} onSelect={ async (sex) => {
                                this.updateMyInfo("sex",sex.toString())
                                context.pop()
                                WKApp.loginInfo.sex = sex
                                WKApp.loginInfo.save()
                            }}></SexSelect>)
                        }
                    }
                }),
            ]
        }))

        // 账号安全 · 实名认证。
        // Phase 2a：未认证点击直跳 IdP 账户页。
        const verified = !!WKApp.loginInfo.realnameVerified
        sections.push(new Section({
            title: "账号安全",
            rows: [
                new Row({
                    cell: ListItem,
                    properties: {
                        title: "实名认证",
                        subTitle: verified
                            ? this.formatVerifiedAtLabel()
                            : "去认证",
                        onClick: () => {
                            if (verified) return
                            this.startRealnameVerify()
                        }
                    }
                })
            ]
        }))

        // 「我的分身」入口 — Persona Clone / AI On-Behalf-Of (PR-C, GH octo-web#46)。
        // 复用 RoutePage + Section/Row DSL：点击 Row 用 context.push 把 PersonaSettings
        // 推进当前 MeInfo 栈，与「我的二维码」同款交互。注意 PersonaSettings 内部为了
        // 承载 PersonaCreate / PersonaEdit 的子级跳转，会再创建一层 nested RoutePage
        // 上下文（PR description 早期文案「zero new routes」并不精确：路由数量没变，
        // 但是确实又多了一层 RouteContext 栈）。
        //
        // 因为存在 nested RoutePage，PersonaSettings 根页面那个「关闭」按钮回调走的是
        // `this.props.onClose`，所以这里必须把 onClose 接到 MeInfo 当前栈的 pop 上，
        // 否则进入分身页之后根级关闭按钮就成了 no-op，用户只能把整个 MeInfo 关掉
        // 才能脱身（YUJ-1178 / PR #47 review 反馈 P1-1）。
        //
        // 设计取舍:这里**不** prefetch / 不查 active grant 状态,subTitle 故意留空,
        // 进入子页才拉数据(后端 PR-A 未 merge 时会 404, 子页 vm 已做 graceful empty
        // 态)。原因:本页是高频入口(每次开 MeInfo 都跑 sections()), 多塞一次 GET
        // /v1/obo/grants 不划算; 而且 PR-A merge 前每次都打 404,日志噪音难处理。
        //
        // Section 故意单独成 section（不并入「账号安全」），原因是 v1 之后这块会扩成
        // 「我的分身 / 草稿审批 / 活动日志」三行,提前做好视觉分组占位。
        sections.push(new Section({
            rows: [
                new Row({
                    cell: ListItem,
                    properties: {
                        title: "我的分身",
                        subTitle: "",
                        onClick: () => {
                            context.push(<PersonaSettings onClose={() => context.pop()} />)
                        }
                    }
                })
            ]
        }))

        return sections
    }
}
