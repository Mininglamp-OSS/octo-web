import type { Thread } from "@octo/base";
import { ThreadStatus } from "@octo/base";
import type {
    ChannelOption,
    LoadChannelsResult,
} from "../ui/LinkChannelsModal";

/**
 * IM "群" 数据的最小 shape — 跟 channelDataSource.groupSaveList() 返回的
 * 单条对应。字段名两套兼容: 老接口 (channel.channelID / channelType /
 * memberCount) + 新接口 (channel_id / channel_type / member_count)。
 */
export interface GroupSaveListRow {
    channel?: { channelID?: string; channelType?: number };
    channel_id?: string;
    channel_type?: number;
    title?: string;
    name?: string;
    remark?: string;
    desc?: string;
    memberCount?: number;
    member_count?: number;
}

/** 注入接口: 让 helper 不直接耦合 WKApp / dmworkbase, 单测好写。 */
export interface LinkableChannelDataSource {
    groupSaveList: () => Promise<GroupSaveListRow[]>;
    threadList: (
        groupNo: string,
        req?: { page_index?: number; page_size?: number },
    ) => Promise<Thread[]>;
}

export interface BuildLinkableChannelsOptions {
    /** 群类型常量 (默认 wukongimjssdk.ChannelTypeGroup = 2)。注入便于测试。*/
    channelTypeGroup: number;
    /** 并发拉子区的 worker 数。默认 4。 */
    concurrency?: number;
    /** 单群子区拉取的 page_size。默认 100。 */
    threadPageSize?: number;
    /** 单群子区拉取失败时的日志钩子, 默认 console.warn。 */
    onThreadListError?: (groupNo: string, err: unknown) => void;
    /** 子区没有名称时展示的兜底名称。 */
    unnamedThreadName?: string;
}

/**
 * 把 "我加入的群" + "每群我加入的活跃子区" 摊平成 LinkChannelsModal 可吃的
 * ChannelOption 列表。
 *
 * 行为:
 *   - 群直接列, 用 channelDataSource.groupSaveList()。
 *   - 每个群类型 (channel_type === channelTypeGroup) 的群再 fan-out 拉子区,
 *     concurrency 路并发, 不阻断 (单群失败不影响其它群)。
 *   - 子区只列 status=Active 且 is_member !== false (允许 undefined)。
 *   - 子区按 parent 群的顺序紧跟在群条目后面摊平, 带上 parentGroupName /
 *     parentGroupNo 给 UI 用。
 *   - 单群子区拉取失败时: 收集失败群名 (拿群 title 显示, 找不到回落 groupNo),
 *     调 onThreadListError 钩子记日志。
 *
 * 这个 helper 是纯函数 (除了注入的 IO), 可以独立单测; UI 层
 * (MatterDetailPanel.loadChannelsForModal) 只负责把 WKApp 的 dataSource
 * 接进来。
 */
export async function buildLinkableChannels(
    ds: LinkableChannelDataSource,
    opts: BuildLinkableChannelsOptions,
): Promise<LoadChannelsResult> {
    const concurrency = opts.concurrency ?? 4;
    const threadPageSize = opts.threadPageSize ?? 100;
    const unnamedThreadName = opts.unnamedThreadName ?? "Unnamed thread";
    const onErr =
        opts.onThreadListError ??
        ((groupNo, err) => {
            // eslint-disable-next-line no-console
            console.warn(
                "[buildLinkableChannels] threadList failed for group",
                groupNo,
                err,
            );
        });

    const groups = await ds.groupSaveList();

    type GroupRow = {
        channelId: string;
        channelType: number;
        name: string;
        desc?: string;
        memberCount?: number;
    };
    const groupOptions: GroupRow[] = (groups || [])
        .map((g) => ({
            channelId: g.channel?.channelID || g.channel_id || "",
            channelType: g.channel?.channelType || g.channel_type || opts.channelTypeGroup,
            name: g.title || g.name || "",
            desc: g.remark || g.desc || "",
            memberCount: g.memberCount || g.member_count || undefined,
        }))
        .filter((g) => !!g.channelId);

    // 只对群类型 (channel_type=Group) 拉子区。
    const groupNos = groupOptions
        .filter((g) => g.channelType === opts.channelTypeGroup)
        .map((g) => g.channelId);
    const groupNameByNo = new Map(
        groupOptions
            .filter((g) => g.channelType === opts.channelTypeGroup)
            .map((g) => [g.channelId, g.name]),
    );

    const threadsByGroup = new Map<string, Thread[]>();
    const failedGroupNames: string[] = [];

    // 简单的 worker pool: 共享 cursor 自增, 每个 worker 抢任务做完再抢下一个。
    // JS 单线程下 cursor++ 没竞争, 不需要锁。
    let cursor = 0;
    async function worker() {
        while (cursor < groupNos.length) {
            const idx = cursor++;
            const no = groupNos[idx];
            try {
                const list = await ds.threadList(no, {
                    page_index: 1,
                    page_size: threadPageSize,
                });
                threadsByGroup.set(no, list || []);
            } catch (err) {
                onErr(no, err);
                threadsByGroup.set(no, []);
                failedGroupNames.push(groupNameByNo.get(no) || no);
            }
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(concurrency, groupNos.length) }, worker),
    );

    // 摊平: 群在前, 该群的活跃子区紧跟在后。
    const result: ChannelOption[] = [];
    for (const g of groupOptions) {
        result.push(g);
        if (g.channelType !== opts.channelTypeGroup) continue;
        const threads = threadsByGroup.get(g.channelId) || [];
        for (const t of threads) {
            if (t.status !== ThreadStatus.Active) continue;
            if (t.is_member === false) continue;
            result.push({
                channelId: t.channel_id,
                channelType: t.channel_type,
                name: t.name || unnamedThreadName,
                memberCount: t.member_count,
                parentGroupName: g.name,
                parentGroupNo: g.channelId,
            });
        }
    }

    return {
        channels: result,
        threadLoadErrors: failedGroupNames.length ? failedGroupNames : undefined,
    };
}
