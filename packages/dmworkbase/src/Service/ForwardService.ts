/**
 * ForwardService — 消息转发发送路径的统一收口。
 *
 * ## 为什么存在
 *
 * `ForwardModal` 的 UI/选人层已经收口（`WKApp.shared.baseContext.showConversationSelect`
 * 是唯一入口），但"选完之后把消息真正发出去"这一步过去在 6 个调用方（Conversation
 * 单条/多选/合并转发、WKBase runDocForward、SummaryDetailPage、Contacts.shareToFriend）
 * 各写了一遍。差异集中在：
 *   1. disband 守卫是否覆盖；
 *   2. `space_id` / `mention.humans|ais` 注入是否走 `wrapSendContentForInjection`；
 *   3. 错误隔离粒度；
 *   4. Toast 分母维度是"目标 channel 数"还是"任务数(messages × channels)"。
 *
 * ForwardService 把上面 4 项收敛到一个可测试的 service。UI 层不动，业务字段注入由
 * 调用方通过 `opts` 传入（Service 层不 import `WKApp`，保持依赖单向）。
 *
 * ## 两阶段执行契约
 *
 * `send()` 分两个阶段：
 *   Phase 1 (build)  对所有目标 channel（含 disbanded）同步调 `buildContent`，收集
 *                    全部 content。任一 `buildContent` 抛错（例如
 *                    InteractiveCardForwardBlockedError）→ 立即 abort，Phase 2 不
 *                    进入、不产生半发送状态。异常向上冒到调用方 try/catch，Service
 *                    不吞。disbanded channel 也进 Phase 1 是为了取到 contents.length
 *                    以正确计入 `messageAttempts` / `failedMessages`（多选转发含
 *                    disbanded 目标时 Toast 分母才不会缩水）——契约要求 buildContent
 *                    必须是**同步无副作用**的纯函数（clone content / 组装 payload），
 *                    对 disbanded channel 多调一次是安全的。
 *   Phase 2 (send)   所有 content 就绪后，仅对 sendable channel 按 channelMode/
 *                    messageMode 投递。sender reject → 计入 `failures[reason=
 *                    'send-error']`，其他任务不受影响。
 *
 * ## 与 vm.sendMessage 的关系
 *
 * `vm.sendMessage` 是"当前会话发消息"的入口（输入框、重发），它内部同样调
 * `wrapSendContentForInjection` + `applyMsgLevelExternalFieldsWithFallback`。
 * ForwardService 走独立的发送路径，两者行为对齐但不互相调用——这是为了避免旧代码
 * 里"目标非当前会话时误进 static sendQueue"的历史噪声。Conversation 内部转发到
 * 当前会话时通过 `opts.onSent` 显式把消息回填到 sendQueue（见调用点）。
 */

import WKSDK, { Channel, Message, MessageContent, Setting } from "wukongimjssdk";
import { isConversationDisbanded } from "../Utils/groupDisband";
import { wrapSendContentForInjection } from "../Utils/sendContentProxy";
import { applyMsgLevelExternalFieldsWithFallback } from "./Convert";
import { ChannelTypePerson } from "wukongimjssdk";

export type ForwardFailureReason = "disbanded" | "send-error";

export interface ForwardFailure {
    channelID: string;
    /** 多 content 场景（同一 channel 多条消息）标识具体是第几条；单 content 场景省略。 */
    messageIndex?: number;
    reason: ForwardFailureReason;
    error?: unknown;
}

/**
 * MessageContent 的 mention 三态字段（业务层扩展）。SDK 类型只暴露 `all`/`uids`，
 * `humans`/`ais` 是 octo-web 自己叠加的字段——见 sendContentProxy.ts header。
 */
interface MentionAware {
    mention?: {
        humans?: number | boolean;
        ais?: number | boolean;
    };
}

export interface ForwardResult {
    /** 传入的目标 channel 数（含 disbanded，未去重）。 */
    targets: number;
    /** 至少一条 content 失败的 channel 数（含 disbanded）。runDocForward/Summary/单条转发 Toast 分母。 */
    failedTargets: number;
    /** 总投递任务数 = Σ per-channel content 数量；disbanded channel 按 1 任务计。 */
    messageAttempts: number;
    /** 失败任务数 = failures.length。Conversation 多选 Toast 分母（含 messages × channels 语义）。 */
    failedMessages: number;
    /** 因 disband 被跳过的 channel 数（同时计入 failedTargets 与 failedMessages）。 */
    disbanded: number;
    failures: ForwardFailure[];
}

export type ForwardSender = (
    content: MessageContent,
    channel: Channel,
    setting: Setting,
) => Promise<Message>;

export interface ForwardOptions {
    /** channel 之间：'parallel'（默认，Promise.all）| 'serial'（for-of + await）。 */
    channelMode?: "parallel" | "serial";
    /** 同 channel 内多条 content 的顺序（buildContent 返回数组时才生效）：默认 'serial'。 */
    messageMode?: "parallel" | "serial";
    /** 仅 messageMode='serial' 时生效：同 channel 相邻两条 content 之间的间隔。 */
    interMessageDelayMs?: number;
    /**
     * DM 场景 `space_id` 注入值；调用方传入（Service 不 import WKApp）。
     * 只对 `channelType === ChannelTypePerson` 的 channel 生效。
     */
    spaceId?: string | null;
    /**
     * 覆盖默认 sender（`WKSDK.chatManager.send`）。当且仅当目标 channel === 当前打开
     * conversation 时，Conversation 侧可传自定义 sender 走 vm.sendMessage 以保留
     * 本地"发送中"气泡。其他调用方全部用默认 sender。
     */
    sender?: ForwardSender;
    /**
     * 每条消息 send resolve 后回调。**只做 UI/queue 副作用**（如 Conversation 把当前
     * 会话的消息塞进 sendQueue），不要重复调 applyMsgLevelExternalFieldsWithFallback
     * ——Service 已在内部统一调用。
     */
    onSent?: (message: Message, channel: Channel, messageIndex?: number) => void;
}

type BuildContentFn = (channel: Channel) => MessageContent | MessageContent[];

interface ChannelPlan {
    channel: Channel;
    contents: MessageContent[];
    disbanded: boolean;
}

function toContentArray(v: MessageContent | MessageContent[]): MessageContent[] {
    return Array.isArray(v) ? v : [v];
}

function readMention(content: MessageContent): { humans: boolean; ais: boolean } {
    const mention = (content as MessageContent & MentionAware).mention;
    return {
        humans: !!(mention && mention.humans),
        ais: !!(mention && mention.ais),
    };
}

function buildSetting(channel: Channel): Setting {
    const setting = new Setting();
    const info = WKSDK.shared().channelManager.getChannelInfo(channel);
    if (info?.orgData?.receipt === 1) {
        setting.receiptEnabled = true;
    }
    return setting;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ForwardService {
    /**
     * 核心原语：把 N 条 content 并发/串行投递到 M 个 channel。
     *
     * @param channels     目标 channel 列表（未过滤 disband）。
     * @param buildContent 每个 channel 调一次（含 disbanded，用于取 contents.length）；
     *                     返回单条或多条 MessageContent。**必须同步**——见 header
     *                     Phase 1 契约。
     * @param opts         行为选项，见 ForwardOptions。
     * @returns            结构化结果（含目标维度 + 消息任务维度双计数）。
     * @throws             `buildContent` 抛出的任何异常（Phase 1 abort，Phase 2 不执行）。
     */
    static async send(
        channels: Channel[],
        buildContent: BuildContentFn,
        opts: ForwardOptions = {},
    ): Promise<ForwardResult> {
        const targets = channels.length;
        const result: ForwardResult = {
            targets,
            failedTargets: 0,
            messageAttempts: 0,
            failedMessages: 0,
            disbanded: 0,
            failures: [],
        };
        if (targets === 0) {
            return result;
        }

        // ── Phase 1 (build) ─────────────────────────────────────────────
        // 对所有 channel（含 disbanded）调 buildContent，得到 contents。任一抛错
        // → 整个 send() reject，Phase 2 不执行。Service 不吞异常。disbanded 也
        // build 是为了取 contents.length 正确计入 messageAttempts / failedMessages
        // ——见 header Phase 1 契约。
        const plans: ChannelPlan[] = [];
        for (const channel of channels) {
            const built = buildContent(channel);
            const contents = toContentArray(built);
            const disbanded = isConversationDisbanded(channel);
            plans.push({ channel, contents, disbanded });
            result.messageAttempts += contents.length;
        }

        // 记账 disbanded：按每 channel 的 contents.length 计入 failures，
        // 与 sendable channel 全部 send-error 时的分母语义对齐。
        for (const plan of plans) {
            if (!plan.disbanded) continue;
            result.disbanded++;
            result.failedTargets++;
            const multi = plan.contents.length > 1;
            for (let i = 0; i < plan.contents.length; i++) {
                result.failures.push({
                    channelID: plan.channel.channelID,
                    messageIndex: multi ? i : undefined,
                    reason: "disbanded",
                });
                result.failedMessages++;
            }
        }

        const sendablePlans = plans.filter((p) => !p.disbanded);
        if (sendablePlans.length === 0) {
            return result;
        }

        // ── Phase 2 (send) ─────────────────────────────────────────────
        const sender: ForwardSender = opts.sender ?? ((c, ch, s) => WKSDK.shared().chatManager.send(c, ch, s));
        const channelMode = opts.channelMode ?? "parallel";
        const messageMode = opts.messageMode ?? "serial";
        const interDelay = opts.interMessageDelayMs ?? 0;
        const spaceId = opts.spaceId ?? null;

        const recordChannelFailure = (channel: Channel, contents: MessageContent[], error: unknown): void => {
            const multi = contents.length > 1;
            for (let i = 0; i < contents.length; i++) {
                result.failures.push({
                    channelID: channel.channelID,
                    messageIndex: multi ? i : undefined,
                    reason: "send-error",
                    error,
                });
                result.failedMessages++;
            }
            result.failedTargets++;
        };

        const sendOneChannel = async (plan: ChannelPlan): Promise<void> => {
            const { channel, contents } = plan;
            const injectSpaceId = spaceId && channel.channelType === ChannelTypePerson ? spaceId : null;
            let setting: Setting;
            try {
                setting = buildSetting(channel);
            } catch (error) {
                // channel 级预处理失败 → 整个 channel 全部 content 计入 send-error，
                // 不影响其他 channel（对齐 header "每任务隔离" 的承诺）。
                recordChannelFailure(channel, contents, error);
                return;
            }
            let channelFailed = false;

            const sendOne = async (content: MessageContent, index: number): Promise<boolean> => {
                let message: Message;
                try {
                    const mention = readMention(content);
                    const wrapped = wrapSendContentForInjection(content, {
                        spaceId: injectSpaceId,
                        mentionHumans: mention.humans,
                        mentionAis: mention.ais,
                    });
                    message = await sender(wrapped, channel, setting);
                } catch (error) {
                    result.failures.push({
                        channelID: channel.channelID,
                        messageIndex: contents.length > 1 ? index : undefined,
                        reason: "send-error",
                        error,
                    });
                    result.failedMessages++;
                    channelFailed = true;
                    return false;
                }
                // 消息已被 SDK 接受 —— 以下收尾都算"发送成功"，异常不能倒过来记 send-error。
                // apply 幂等：若自定义 sender（如 vm.sendMessage wrapper）内部已调过，这里重复调无副作用。
                // onSent 只做 UI/queue 副作用（如塞 sendQueue）。
                applyMsgLevelExternalFieldsWithFallback(message, undefined);
                opts.onSent?.(message, channel, contents.length > 1 ? index : undefined);
                return true;
            };

            if (messageMode === "serial") {
                // serial + 多 chunk 失败传播：某 chunk reject → 跳过该 channel 剩余 chunks。
                for (let i = 0; i < contents.length; i++) {
                    const ok = await sendOne(contents[i], i);
                    if (!ok) {
                        // 该 channel 剩余 chunks 也计入 failedMessages（对齐 SummaryDetailPage 现状）。
                        for (let j = i + 1; j < contents.length; j++) {
                            result.failures.push({
                                channelID: channel.channelID,
                                messageIndex: j,
                                reason: "send-error",
                            });
                            result.failedMessages++;
                        }
                        break;
                    }
                    if (interDelay > 0 && i < contents.length - 1) {
                        await wait(interDelay);
                    }
                }
            } else {
                await Promise.all(contents.map((c, i) => sendOne(c, i)));
            }

            if (channelFailed) {
                result.failedTargets++;
            }
        };

        if (channelMode === "serial") {
            for (const plan of sendablePlans) {
                await sendOneChannel(plan);
            }
        } else {
            await Promise.all(sendablePlans.map((plan) => sendOneChannel(plan)));
        }

        return result;
    }
}
